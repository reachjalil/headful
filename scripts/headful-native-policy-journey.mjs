/** Installed Codex/app-server + real Mac sandbox. No model turn, account login,
 * Salesforce request or real credential is used. Synthetic loopback MCP only. */
/* oxlint-disable t3code/no-global-process-runtime -- Standalone native probe reads the host platform before creating its isolated test home. */
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import * as NodeReadline from "node:readline";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  nativeAgentConfig,
  assertNativeAgentSession,
  assertNativeAgentInventory,
} from "../apps/server/src/headful/NativeAgentPolicy.ts";

if (process.platform !== "darwin")
  throw new Error("This journey requires the supported Mac sandbox.");
const executable = process.env.HEADFUL_CODEX_EXECUTABLE ?? "codex";
const root = await NodeFSP.realpath(
  await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "headful-native-policy-")),
);
let child, lines, server;
try {
  const home = NodePath.join(root, "home"),
    workspace = NodePath.join(root, "workspace"),
    outside = NodePath.join(root, "outside-fixture.txt");
  await NodeFSP.mkdir(home, { mode: 0o700 });
  await NodeFSP.mkdir(workspace, { mode: 0o700 });
  await NodeFSP.writeFile(outside, "SYNTHETIC ONLY");
  await NodeFSP.writeFile(NodePath.join(workspace, "input.txt"), "READABLE");
  const token = "Bearer synthetic-headful-policy-journey";
  server = NodeHttp.createServer(async (request, response) => {
    if (request.headers.authorization !== token || request.method !== "POST") {
      response.writeHead(401);
      response.end();
      return;
    }
    let raw = "";
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 16000) {
        response.writeHead(413);
        response.end();
        return;
      }
    }
    const message = JSON.parse(raw);
    if (message.id === undefined) {
      response.writeHead(202);
      response.end();
      return;
    }
    const result =
      message.method === "initialize"
        ? {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "headful-admin-policy-fixture", version: "1.0.0" },
          }
        : message.method === "tools/list"
          ? {
              tools: [
                {
                  name: "list_orgs",
                  description: "Synthetic policy fixture only",
                  inputSchema: { type: "object", properties: {}, additionalProperties: false },
                },
              ],
            }
          : message.method === "resources/list"
            ? { resources: [] }
            : message.method === "resources/templates/list"
              ? { resourceTemplates: [] }
              : undefined;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        ...(result
          ? { result }
          : { error: { code: -32601, message: "Fixture method unavailable" } }),
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
  const config = nativeAgentConfig({
    ownerModId: "headful.connect-desktop",
    threadId: "headful-agent-policy_fixture_12345",
    projectId: "synthetic-project",
    providerInstanceId: "synthetic-provider",
    model: "synthetic-model",
    expiresAt: Date.now() + 60000,
    workspace,
    revokedAt: null,
    mcp: { endpoint, authorization: token, tools: ["list_orgs"] },
  });
  const profile = config.default_permissions;
  await NodeFSP.writeFile(
    NodePath.join(home, "config.toml"),
    `approval_policy = "never"\ndefault_permissions = ${JSON.stringify(profile)}\n[permissions.${profile}.filesystem]\n":minimal" = "read"\n${JSON.stringify(workspace)} = "read"\n[permissions.${profile}.network]\nenabled = false\n`,
  );
  const env = { ...process.env, CODEX_HOME: home };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  const probes = [
    ["workspace_read", ["/bin/cat", NodePath.join(workspace, "input.txt")], true],
    ["outside_read", ["/bin/cat", outside], false],
    ["workspace_write", ["/bin/sh", "-c", "echo denied > blocked.txt"], false],
  ];
  const checks = [];
  for (const [name, command, allowed] of probes) {
    const outcome = NodeChildProcess.spawnSync(
      executable,
      ["sandbox", "-C", workspace, "--permission-profile", profile, "--", ...command],
      { env, timeout: 10000, encoding: "utf8" },
    );
    NodeAssert.equal(outcome.error, undefined);
    NodeAssert.equal(outcome.status === 0, allowed, name);
    if (allowed) NodeAssert.equal(outcome.stdout.trim(), "READABLE");
    checks.push({ name, allowed, exit: outcome.status });
  }
  child = NodeChildProcess.spawn(executable, ["app-server", "--listen", "stdio://"], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  const pending = new Map();
  let nextId = 0;
  lines = NodeReadline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line),
        wait = pending.get(message.id);
      if (wait) {
        pending.delete(message.id);
        if (message.error)
          wait.reject(new Error("App-server request failed: " + message.error.code));
        else wait.resolve(message.result);
      }
    } catch {
      /* Non-RPC diagnostic is not evidence. */
    }
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("App-server timeout: " + method));
        }, 15000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  await request("initialize", {
    clientInfo: { name: "headful-native-policy-journey", version: "1.0.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }) + "\n");
  const params = { cwd: workspace, approvalPolicy: "never", config, ephemeral: true };
  const response = await request("thread/start", params);
  assertNativeAgentSession(response, params);
  const inventory = await request("mcpServerStatus/list", {
    threadId: response.thread.id,
    limit: 100,
    detail: "full",
  });
  assertNativeAgentInventory(inventory, ["list_orgs"], config);
  const version = NodeChildProcess.spawnSync(executable, ["--version"], {
    env,
    encoding: "utf8",
    timeout: 5000,
  }).stdout.trim();
  const evidence = {
    verifiedAt: new Date().toISOString(),
    status: "passed",
    version,
    checks,
    effectiveSession: {
      approvalPolicy: response.approvalPolicy,
      sandbox: response.sandbox,
      profileId: response.activePermissionProfile.id,
      cwdMatches: true,
    },
    exactConnectedMcp: true,
    modelTurn: false,
    liveSalesforce: false,
    sourceSha256: NodeCrypto.createHash("sha256")
      .update(
        await NodeFSP.readFile(
          new URL("../apps/server/src/headful/NativeAgentPolicy.ts", import.meta.url),
        ),
      )
      .digest("hex"),
  };
  const output = new URL("../artifacts/headful/native-agent-policy.json", import.meta.url);
  await NodeFSP.mkdir(new URL("./", output), { recursive: true });
  await NodeFSP.writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
} finally {
  lines?.close();
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("exit", resolve);
      setTimeout(resolve, 1000);
    });
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await NodeFSP.rm(root, { recursive: true, force: true });
}
