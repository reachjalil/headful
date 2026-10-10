// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalTimers:off globalDate:off preferSchemaOverJson:off
import { experienceIds } from "@t3tools/contracts/headful-experiences";
import * as NodeHttp from "node:http";
import * as NodeFSP from "node:fs/promises";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import * as Electron from "electron";
import { z } from "zod";
import {
  controlActions,
  controlScopes,
  runRecipe,
  type ControlAction,
  type ControlScope,
} from "./ControlProtocol.ts";

const pairInput = z.strictObject({
  client: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[\w .-]+$/),
  scopes: z.array(z.enum(controlScopes)).min(1).max(5),
});
const hash = (value: string) => NodeCrypto.createHash("sha256").update(value).digest();
const equal = (a: string, b: string) => NodeCrypto.timingSafeEqual(hash(a), hash(b));
const windowFor = () =>
  Electron.BrowserWindow.getAllWindows().find(
    (window) =>
      !window.isDestroyed() && /^headful(?:-dev)?:\/\/app\//.test(window.webContents.getURL()),
  );
const jsonLiteral = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export async function startDesktopControl(homeDir: string, dev: boolean) {
  const bootstrap = NodeCrypto.randomBytes(32).toString("base64url");
  const grants = new Map<
    string,
    { digest: string; client: string; scopes: ControlScope[]; expires: number }
  >();
  let pairing = false;
  let running = false;
  let rendererGrant: string | undefined;
  const execute = async (method: ControlAction, rawInput: unknown): Promise<unknown> => {
    const input = controlActions[method].parse(rawInput);
    const window = windowFor();
    if (method === "diagnostics")
      return {
        product: "Headful",
        development: dev,
        version: Electron.app.getVersion(),
        windowReady: Boolean(window),
        rendererLoaded: Boolean(window && !window.webContents.isLoading()),
        experiences: dev ? experienceIds : [],
        authority: "App inspection only; no shell, CLI, filesystem or Salesforce operations.",
      };
    if (!dev || !window) throw new Error("A development app window is required.");
    const renderer = async (operation: string, arg: unknown = {}) =>
      window.webContents.executeJavaScript(
        `window.__headfulExperienceControl?.(${jsonLiteral(operation)}, ${jsonLiteral(arg)})`,
        true,
      );
    if (method === "screenshot") {
      const state = await renderer("state");
      const image = await window.webContents.capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      });
      if (image.isEmpty()) throw new Error("Screenshot unavailable.");
      const png = image.toPNG();
      if (png.length > 4_000_000) throw new Error("Screenshot exceeds evidence limit.");
      return {
        mimeType: "image/png",
        data: png.toString("base64"),
        state,
        width: image.getSize().width,
        height: image.getSize().height,
      };
    }
    if (method === "record" && "frames" in input) {
      const frames: unknown[] = [];
      for (let i = 0; i < input.frames; i++) {
        if (i) await new Promise((resolve) => setTimeout(resolve, input.intervalMs));
        frames.push({ at: Date.now(), capture: await execute("screenshot", {}) });
      }
      return { kind: "frame-recording", intervalMs: input.intervalMs, frames };
    }
    if (method === "press" && "key" in input) {
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: input.key });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: input.key });
      return renderer("state");
    }
    if (method === "scroll" && "deltaY" in input) {
      window.webContents.sendInputEvent({
        type: "mouseWheel",
        x: 200,
        y: 200,
        deltaY: input.deltaY,
        deltaX: 0,
      });
      return renderer("state");
    }
    const result: unknown = await renderer(method, input);
    if (result === undefined) throw new Error("Experience control is not ready.");
    return result;
  };
  const authorize = async (raw: unknown) => {
    const request = pairInput.parse(raw);
    if (!dev && request.scopes.some((scope) => scope !== "diagnostics"))
      throw new Error("Only diagnostics is available in a packaged app.");
    if (pairing) throw new Error("Another pairing request is pending.");
    pairing = true;
    try {
      const options: Electron.MessageBoxOptions = {
        type: "question",
        title: "Authorize Headful control",
        message: `Allow ${request.client} to control Headful?`,
        detail: `Permissions: ${request.scopes.join(", ")}.\nExpires in 1 hour. Screenshots may reveal app content. Salesforce writes and credentials are excluded.\nUse the Headful menu to revoke all control connections.`,
        buttons: ["Deny", "Authorize"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      const window = windowFor();
      const result = window
        ? await Electron.dialog.showMessageBox(window, options)
        : await Electron.dialog.showMessageBox(options);
      if (result.response !== 1) throw new Error("Connection denied by the user.");
      const token = NodeCrypto.randomBytes(32).toString("base64url");
      const id = NodeCrypto.randomUUID();
      const expires = Date.now() + 3_600_000;
      grants.set(id, {
        digest: hash(token).toString("hex"),
        client: request.client,
        scopes: request.scopes,
        expires,
      });
      return { token: `${id}.${token}`, expires, scopes: request.scopes };
    } finally {
      pairing = false;
    }
  };
  const resolveGrant = (token: string) => {
    const [id, secret] = token.split(".");
    const grant = id ? grants.get(id) : undefined;
    if (
      !grant ||
      !secret ||
      grant.expires <= Date.now() ||
      !equal(grant.digest, hash(secret).toString("hex"))
    )
      throw new Error("Control connection is missing, expired or revoked.");
    return grant;
  };
  const run = async (token: string, code: string) => {
    const grant = resolveGrant(token);
    if (running) throw new Error("A control recipe is already running.");
    running = true;
    try {
      return await runRecipe(code, grant.scopes, dev, async (method, input) => {
        resolveGrant(token); // Revocation and expiration apply to every step.
        return await new Promise<unknown>((resolve, reject) => {
          const deadline = setTimeout(
            () =>
              reject(new Error("Control step timed out; inspect the app before running again.")),
            method === "record" ? 17_000 : 5_000,
          );
          void execute(method, input)
            .then(resolve, reject)
            .finally(() => clearTimeout(deadline));
        });
      });
    } finally {
      running = false;
    }
  };
  const server = NodeHttp.createServer(async (request, response) => {
    const send = (status: number, value: unknown) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(value));
    };
    // Browser origins are never accepted: local tools use a protected bootstrap
    // file and native consent, then a scoped grant. Bind exclusively to loopback.
    if (request.headers.origin || !/^127\.0\.0\.1:\d+$/.test(request.headers.host ?? ""))
      return send(403, { error: "Local client required." });
    if (request.method !== "POST") return send(405, { error: "POST required." });
    try {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 32_000) {
          send(413, { error: "Request too large." });
          return;
        }
      }
      const data: unknown = JSON.parse(body);
      if (request.url === "/pair") {
        if (!equal(String(request.headers["x-headful-bootstrap"] ?? ""), bootstrap))
          return send(401, { error: "Pairing credential required." });
        return send(200, await authorize(data));
      }
      const token = String(request.headers.authorization ?? "").replace(/^Bearer /, "");
      const grant = resolveGrant(token);
      if (request.url === "/revoke") {
        grants.clear();
        rendererGrant = undefined;
        return send(200, { revoked: true });
      }
      if (request.url !== "/mcp") return send(404, { error: "Unknown endpoint." });
      const rpc = z
        .object({
          jsonrpc: z.literal("2.0"),
          id: z.union([z.string(), z.number()]).optional(),
          method: z.string(),
          params: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(data);
      if (rpc.id === undefined) {
        response.writeHead(202);
        response.end();
        return;
      }
      let result: unknown;
      if (rpc.method === "initialize")
        result = {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "Headful Desktop Control", version: "0.1.0" },
        };
      else if (rpc.method === "ping") result = {};
      else if (rpc.method === "tools/list")
        result = {
          tools: [
            {
              name: "desktop_diagnostics",
              description: "Inspect redacted Headful app health.",
              inputSchema: { type: "object", additionalProperties: false, properties: {} },
              annotations: { readOnlyHint: true, openWorldHint: false },
            },
            ...(dev
              ? [
                  {
                    name: "desktop_execute",
                    description:
                      'Execute 1–24 typed steps: await app.state(); await app.flow({"id":"initial"}); await app.screenshot(); No arbitrary JavaScript. See app control recipe documentation.',
                    inputSchema: {
                      type: "object",
                      required: ["code"],
                      additionalProperties: false,
                      properties: { code: { type: "string", maxLength: 16000 } },
                    },
                    annotations: {
                      readOnlyHint: false,
                      destructiveHint: false,
                      openWorldHint: false,
                    },
                  },
                ]
              : []),
          ],
        };
      else if (rpc.method === "tools/call") {
        const call = z
          .strictObject({
            name: z.string(),
            arguments: z.record(z.string(), z.unknown()).optional(),
          })
          .parse(rpc.params);
        try {
          const outcome =
            call.name === "desktop_diagnostics"
              ? await run(token, "await app.diagnostics();")
              : call.name === "desktop_execute" && dev
                ? await run(token, z.strictObject({ code: z.string() }).parse(call.arguments).code)
                : (() => {
                    throw new Error("Unknown tool.");
                  })();
          result = {
            content: [{ type: "text", text: JSON.stringify(outcome) }],
            structuredContent: outcome,
          };
        } catch (error) {
          result = {
            isError: true,
            content: [
              { type: "text", text: error instanceof Error ? error.message : "Control failed." },
            ],
          };
        }
      } else
        return send(200, {
          jsonrpc: "2.0",
          id: rpc.id,
          error: { code: -32601, message: "Method not found." },
        });
      void grant;
      send(200, { jsonrpc: "2.0", id: rpc.id, result });
    } catch {
      send(401, { error: "Invalid or unauthorized control request." });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  server.requestTimeout = 20_000;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Control endpoint unavailable.");
  await NodeFSP.mkdir(homeDir, { recursive: true, mode: 0o700 });
  const sessionFile = NodePath.join(homeDir, "desktop-control.json");
  await NodeFSP.writeFile(
    sessionFile,
    JSON.stringify({ origin: `http://127.0.0.1:${address.port}`, bootstrap, dev }),
    { mode: 0o600 },
  );
  const trusted = (event: Electron.IpcMainInvokeEvent) =>
    event.senderFrame === event.sender.mainFrame &&
    event.sender.getURL().startsWith("headful-dev://app/");
  if (dev)
    Electron.ipcMain.handle("headful:experienceControl", async (event, code: unknown) => {
      if (!trusted(event) || typeof code !== "string") throw new Error("Development app required.");
      if (!rendererGrant)
        rendererGrant = (await authorize({ client: "Headful WebMCP", scopes: [...controlScopes] }))
          .token;
      return run(rendererGrant, code);
    });
  return {
    revoke: () => {
      grants.clear();
      rendererGrant = undefined;
    },
    close: async () => {
      grants.clear();
      server.close();
      if (dev) Electron.ipcMain.removeHandler("headful:experienceControl");
      await NodeFSP.rm(sessionFile, { force: true });
    },
  };
}
