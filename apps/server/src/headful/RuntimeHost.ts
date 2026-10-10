import * as AgentRunner from "./AgentRunner.ts";
import type { HeadfulAgentRunnerFactory } from "../../../../packages/contracts/src/headful-agent.ts";
// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
// Headful is one scoped service in the existing T3 server process. Transports
// never own an executor. The loopback boundary is not a mobile relay.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NodeHttp from "node:http";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as Lockfile from "proper-lockfile";
import * as NodeStream from "node:stream";
import { z } from "zod";
import * as ServerConfig from "../config.ts";
import { headfulRpcRequestSchema } from "../../../../packages/contracts/src/headful.ts";
import { ModError } from "../../../../packages/mod-sdk/src/schema.ts";
import { ModRepository } from "./InstalledMods.ts";
import { CommunityExecution } from "./mods/CommunityExecution.ts";
import { createModBroker } from "./mods/ModBroker.ts";
import { makeHeadfulRuntime, type HeadfulRuntime } from "./WorkspaceService.ts";
import { HttpError } from "./domain/types.ts";

// Capture before the upstream dependency graph starts provider probes. This
// module is the first server import; descendants must never inherit authority.
const bootstrapDesktopCapability = process.env.HEADFUL_DESKTOP_CAPABILITY;
delete process.env.HEADFUL_DESKTOP_CAPABILITY;

export class HeadfulHostError extends Schema.TaggedError<HeadfulHostError>()("HeadfulHostError", {
  cause: Schema.Defect(),
}) {
  override get message() {
    return "Headful local runtime could not start.";
  }
}
export class RuntimeHost extends Context.Service<RuntimeHost, { readonly origin: string }>()(
  "t3/headful/RuntimeHost",
) {}
const ownerSchema = z.strictObject({
  pid: z.number().int().positive(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{24}$/),
});
const isMissing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

async function privateRegularFile(file: string) {
  const info = await NodeFSP.lstat(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0 ||
    info.size > 4096
  )
    throw new Error("Unsafe local runtime metadata.");
  return NodeFSP.readFile(file, "utf8");
}
async function writeMetadata(file: string, contents: unknown) {
  const temporary = `${file}.${NodeCrypto.randomBytes(9).toString("base64url")}.tmp`;
  await NodeFSP.writeFile(temporary, JSON.stringify(contents), { flag: "wx", mode: 0o600 });
  try {
    await NodeFSP.rename(temporary, file);
    await NodeFSP.chmod(file, 0o600);
  } catch (error) {
    await NodeFSP.unlink(temporary).catch(() => undefined);
    throw error;
  }
}
function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

/** Only the native main process receives the memory-held capability. No owner
 * bearer token is placed on disk for a local harness to turn into human authority. */
export async function startRuntimeHost(
  homeDir: string,
  options: { desktopCapability?: string; agentRunner?: HeadfulAgentRunnerFactory } = {},
) {
  const inheritedCapability = process.env.HEADFUL_DESKTOP_CAPABILITY;
  delete process.env.HEADFUL_DESKTOP_CAPABILITY;
  const capability = options.desktopCapability ?? inheritedCapability ?? bootstrapDesktopCapability;
  await NodeFSP.mkdir(homeDir, { recursive: true, mode: 0o700 });
  const directory = await NodeFSP.lstat(homeDir);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    directory.uid !== process.getuid?.()
  )
    throw new Error("Unsafe Headful runtime directory.");
  await NodeFSP.chmod(homeDir, 0o700);
  // Serialize startup/stale-owner recovery. This guard is released after startup;
  // the PID+nonce owner file then preserves runtime ownership for its lifetime.
  const releaseStartup = await Lockfile.lock(homeDir, {
    lockfilePath: NodePath.join(homeDir, "runtime-start.lock"),
    retries: 0,
  });
  const lockFile = NodePath.join(homeDir, "runtime.lock");
  const runtimeFile = NodePath.join(homeDir, "mcp-runtime.json");
  const sessionFile = NodePath.join(homeDir, "desktop-session.json");
  const owner = { pid: process.pid, nonce: NodeCrypto.randomBytes(18).toString("base64url") };
  let runtime: HeadfulRuntime | undefined;
  let server: NodeHttp.Server | undefined;
  let owned = false;
  let closing: Promise<void> | undefined;
  let origin = "";
  const key =
    capability && /^[A-Za-z0-9_-]{43}$/.test(capability)
      ? Buffer.from(capability, "base64url")
      : undefined;
  const removeOwnedMetadata = async () => {
    for (const file of [runtimeFile, sessionFile, lockFile]) {
      try {
        const value: unknown = JSON.parse(await privateRegularFile(file));
        if (
          typeof value === "object" &&
          value !== null &&
          "pid" in value &&
          value.pid === owner.pid &&
          "nonce" in value &&
          value.nonce === owner.nonce
        )
          await NodeFSP.unlink(file);
      } catch {
        /* Never delete a replacement runtime's files or unique data. */
      }
    }
  };
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      if (server?.listening) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
      try {
        await runtime?.close();
      } finally {
        if (owned) await removeOwnedMetadata();
      }
    })());
  try {
    try {
      const old = ownerSchema.parse(JSON.parse(await privateRegularFile(lockFile)));
      if (isAlive(old.pid)) throw new Error("Another Headful runtime already owns this store.");
      await NodeFSP.unlink(lockFile);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const lock = await NodeFSP.open(lockFile, "wx", 0o600);
    try {
      await lock.writeFile(JSON.stringify(owner));
    } finally {
      await lock.close();
    }
    owned = true;
    const execution = new CommunityExecution(
      createModBroker(
        () => runtime!.store,
        () => runtime!.mods,
      ),
    );
    const repository = new ModRepository(
      homeDir,
      execution,
      process.env.HEADFUL_MODS_DIR || undefined,
    );
    runtime = makeHeadfulRuntime({
      homeDir,
      mods: await repository.load(),
      ...(options.agentRunner ? { agentRunner: options.agentRunner } : {}),
      modHost: {
        homeDir,
        executable: process.execPath,
        runtimeFile,
        ...(process.env.HEADFUL_MCP_BRIDGE ? { bridgeScript: process.env.HEADFUL_MCP_BRIDGE } : {}),
        ...(process.env.HEADFUL_MCP_ASSETS
          ? { assetsDirectory: process.env.HEADFUL_MCP_ASSETS }
          : {}),
      },
    });
    const service = runtime;
    await service.mods.initialize();
    server = NodeHttp.createServer(async (request, response) => {
      const json = (status: number, value: unknown) => {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        response.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(JSON.stringify(value));
      };
      try {
        // Browser origins, foreign Hosts and DNS rebinding cannot use this native
        // endpoint. MCP Apps call through the host rather than browser fetch.
        if (
          !origin ||
          request.headers.host !== new URL(origin).host ||
          request.headers.origin !== undefined
        ) {
          json(403, { error: "Local application or authorized bridge required." });
          return;
        }
        const pathname = new URL(request.url || "/", origin).pathname;
        if (pathname !== "/mcp" && pathname !== "/rpc") {
          json(404, { error: "Unknown local route." });
          return;
        }
        if (request.method !== "POST") {
          json(405, { error: "POST required." });
          return;
        }
        const maximum = pathname === "/mcp" ? 65_536 : 512_000;
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > maximum) {
            json(413, { error: "Request too large." });
            return;
          }
          chunks.push(Buffer.from(chunk));
        }
        const body = Buffer.concat(chunks);
        if (pathname === "/mcp") {
          const headers = new Headers();
          for (const [name, value] of Object.entries(request.headers))
            if (typeof value === "string") headers.set(name, value);
          const result = await service.mods.handleMcp(
            new Request(`${origin}/mcp`, { method: "POST", headers, body }),
          );
          response.writeHead(result.status, Object.fromEntries(result.headers));
          if (result.body) NodeStream.Readable.fromWeb(result.body).pipe(response);
          else response.end();
          return;
        }
        const signature = request.headers["x-headful-desktop-signature"];
        if (!key || typeof signature !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
          json(401, { error: "Native desktop authorization required." });
          return;
        }
        const expected = NodeCrypto.createHmac("sha256", key).update(body).digest();
        if (!NodeCrypto.timingSafeEqual(expected, Buffer.from(signature, "base64url"))) {
          json(401, { error: "Native desktop authorization required." });
          return;
        }
        let value: unknown;
        try {
          value = JSON.parse(body.toString("utf8"));
        } catch {
          json(400, { error: "Invalid desktop request." });
          return;
        }
        const envelope = z
          .strictObject({ operation: z.string().max(80), input: z.unknown() })
          .safeParse(value);
        if (!envelope.success) {
          json(400, { error: "Invalid desktop request." });
          return;
        }
        const internal = z.strictObject({
          context: z.string().uuid(),
          method: z.string().max(180),
          input: z.unknown(),
        });
        if (envelope.data.operation === "mods.execution.fail") {
          const i = z.strictObject({ context: z.string().uuid() }).parse(envelope.data.input);
          const id = execution.modForContext(i.context);
          if (id) await service.mods.fail(id);
          json(200, { result: { stopped: true } });
          return;
        }
        if (envelope.data.operation === "mods.execution.pull") {
          json(200, { result: execution.pull() });
          return;
        }
        if (envelope.data.operation === "mods.execution.reply") {
          const i = z
            .strictObject({
              context: z.string().uuid(),
              id: z.string().uuid(),
              result: z.unknown().optional(),
              error: z.string().max(300).optional(),
            })
            .parse(envelope.data.input);
          json(200, { result: execution.reply(i.context, i.id, i.result ?? null, i.error) });
          return;
        }
        if (envelope.data.operation === "mods.broker") {
          const i = internal.parse(envelope.data.input);
          json(200, { result: await execution.call(i.context, i.method, i.input) });
          return;
        }
        if (envelope.data.operation === "mods.install") {
          const i = z.strictObject({ path: z.string().max(1000) }).parse(envelope.data.input);
          const definitions = await repository.install(i.path, (definitions) =>
            service.mods.validateDefinitions(definitions),
          );
          await service.mods.replaceDefinitions(definitions);
          await repository.pruneRetired();
          json(200, { result: service.mods.list() });
          return;
        }
        if (envelope.data.operation === "mods.uninstall") {
          const i = z.strictObject({ id: z.string().max(128) }).parse(envelope.data.input);
          await service.mods.disable(i.id);
          const definitions = await repository.uninstall(i.id);
          await service.mods.replaceDefinitions(definitions);
          json(200, { result: service.mods.list() });
          return;
        }
        if (envelope.data.operation === "mods.deleteData") {
          const i = z.strictObject({ id: z.string().max(128) }).parse(envelope.data.input);
          json(200, { result: await service.mods.deleteData(i.id) });
          return;
        }
        if (envelope.data.operation === "mods.background") {
          const i = z
            .strictObject({
              id: z.string().max(128),
              revision: z.string().regex(/^[a-f0-9]{64}$/),
              settings: z.unknown(),
            })
            .parse(envelope.data.input);
          json(200, { result: await service.mods.startBackground(i.id, i.revision, i.settings) });
          return;
        }
        if (envelope.data.operation === "mods.grant") {
          const i = z
            .strictObject({
              id: z.string().max(128),
              revision: z.string().regex(/^[a-f0-9]{64}$/),
              permissions: z.array(z.string().max(100)).max(40),
            })
            .parse(envelope.data.input);
          json(200, { result: await service.mods.grant(i.id, i.revision, i.permissions) });
          return;
        }
        const result = service.mods.acceptsDesktopIntegration(envelope.data.operation)
          ? await service.mods.dispatchDesktopIntegration(
              envelope.data.operation,
              envelope.data.input,
            )
          : await service.dispatch(
              headfulRpcRequestSchema.parse(value).operation,
              envelope.data.input,
              { kind: "desktop" },
            );
        json(200, { result });
      } catch (error) {
        // Never reflect Node, JSON, Zod or provider exceptions into diagnostics.
        json(error instanceof HttpError ? error.status : error instanceof ModError ? 409 : 400, {
          code:
            error instanceof HttpError || error instanceof ModError
              ? error.code
              : "invalid_request",
          error:
            error instanceof HttpError || error instanceof ModError
              ? error.message
              : "Headful could not complete this local request. Check the selected org and workflow.",
        });
      }
    });
    server.requestTimeout = 120_000;
    server.headersTimeout = 10_000;
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No loopback address.");
    origin = `http://127.0.0.1:${address.port}`;
    await writeMetadata(sessionFile, { origin, ...owner, protocolVersion: 1 });
    await writeMetadata(runtimeFile, { origin, ...owner, protocolVersion: 1 });
    return { origin, close };
  } catch (error) {
    await close();
    throw error;
  } finally {
    await releaseStartup();
  }
}
const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const runner = yield* AgentRunner.AgentRunner;
  const host = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        startRuntimeHost(NodePath.join(config.stateDir, "headful"), {
          agentRunner: runner.factory,
        }),
      catch: (cause) => new HeadfulHostError({ cause }),
    }),
    (host) => Effect.promise(host.close),
  );
  return RuntimeHost.of({ origin: host.origin });
});
export const layer = Layer.effect(RuntimeHost, make).pipe(Layer.provide(AgentRunner.layer));
