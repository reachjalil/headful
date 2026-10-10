// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalFetch:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeHttp from "node:http";
import { afterEach, expect, it } from "vite-plus/test";
import { startRuntimeHost } from "./RuntimeHost.ts";

const directories: string[] = [];
const hosts: Array<Awaited<ReturnType<typeof startRuntimeHost>>> = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
  for (const directory of directories.splice(0)) await NodeFSP.rm(directory, { recursive: true });
});
async function directory() {
  const value = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "headful-native-host-"));
  directories.push(value);
  return value;
}
const capability = () => NodeCrypto.randomBytes(32).toString("base64url");
const signature = (key: string, body: string) =>
  NodeCrypto.createHmac("sha256", Buffer.from(key, "base64url")).update(body).digest("base64url");
async function post(
  origin: string,
  body: string,
  key?: string,
  headers: Record<string, string> = {},
) {
  return fetch(origin + "/rpc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "X-Headful-Desktop-Signature": signature(key, body) } : {}),
      ...headers,
    },
    body,
  });
}

it("requires a memory-held native signature bound to the exact body, independent of local MCP grants", async () => {
  const homeDir = await directory(),
    key = capability();
  const host = await startRuntimeHost(homeDir, { desktopCapability: key });
  hosts.push(host);
  const body = JSON.stringify({ operation: "status", input: {} });
  expect((await post(host.origin, body)).status).toBe(401);
  expect((await post(host.origin, body, capability())).status).toBe(401);
  expect(
    (
      await post(host.origin, body + " ", undefined, {
        "X-Headful-Desktop-Signature": signature(key, body),
      })
    ).status,
  ).toBe(401);
  const authorized = await post(host.origin, body, key);
  expect(authorized.status).toBe(200);
  expect(await authorized.json()).toMatchObject({
    result: { product: "Headful", local: true, accountRequired: false, orgs: [] },
  });
  const metadata = await NodeFSP.readFile(NodePath.join(homeDir, "desktop-session.json"), "utf8");
  expect(metadata).not.toContain(key);
  expect(metadata).not.toContain("token");
  expect((await NodeFSP.lstat(NodePath.join(homeDir, "desktop-session.json"))).mode & 0o077).toBe(
    0,
  );
  const token = NodeCrypto.randomBytes(32).toString("base64url");
  expect(
    (await post(host.origin, body, undefined, { Authorization: "Bearer " + token })).status,
  ).toBe(401);
  expect(
    (
      await fetch(host.origin + "/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "X-Headful-Desktop-Signature": signature(key, body),
        },
        body,
      })
    ).status,
  ).toBe(404);
});

it("rejects browser origins, rebinding Hosts, oversized requests and malformed signed envelopes", async () => {
  const homeDir = await directory(),
    key = capability();
  const host = await startRuntimeHost(homeDir, { desktopCapability: key });
  hosts.push(host);
  const body = JSON.stringify({ operation: "status", input: {} });
  expect((await post(host.origin, body, key, { Origin: "https://foreign.example" })).status).toBe(
    403,
  );
  expect((await post(host.origin, body, key, { Origin: "null" })).status).toBe(403);
  const foreignHost = await new Promise<number>((resolve) => {
    const call = NodeHttp.request(
      host.origin + "/rpc",
      {
        method: "POST",
        headers: {
          Host: "foreign.example",
          "Content-Type": "application/json",
          "X-Headful-Desktop-Signature": signature(key, body),
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    call.end(body);
  });
  expect(foreignHost).toBe(403);
  expect((await post(host.origin, "x".repeat(512_001), key)).status).toBe(413);
  const malformed = "private malformed content {";
  const invalid = await post(host.origin, malformed, key);
  expect(invalid.status).toBe(400);
  expect(await invalid.text()).not.toContain("private malformed");
  const invalidOperation = JSON.stringify({ operation: "steal-local-files", input: {} });
  const invalidResult = await post(host.origin, invalidOperation, key);
  expect(invalidResult.status).toBe(400);
  expect(await invalidResult.text()).not.toContain("Zod");
});

it("keeps one executor per store, cleans its owned metadata and rotates native authority on restart", async () => {
  const homeDir = await directory(),
    oldKey = capability();
  const first = await startRuntimeHost(homeDir, { desktopCapability: oldKey });
  await expect(startRuntimeHost(homeDir, { desktopCapability: capability() })).rejects.toThrow(
    "already owns",
  );
  await first.close();
  await first.close();
  for (const name of ["runtime.lock", "mcp-runtime.json", "desktop-session.json"])
    await expect(NodeFSP.lstat(NodePath.join(homeDir, name))).rejects.toThrow();
  const newKey = capability();
  const second = await startRuntimeHost(homeDir, { desktopCapability: newKey });
  hosts.push(second);
  const body = JSON.stringify({ operation: "status", input: {} });
  expect((await post(second.origin, body, oldKey)).status).toBe(401);
  expect((await post(second.origin, body, newKey)).status).toBe(200);
});

it("fails closed without a native capability and keeps replacement metadata on cleanup", async () => {
  const homeDir = await directory();
  const host = await startRuntimeHost(homeDir, { desktopCapability: "invalid" });
  expect((await post(host.origin, JSON.stringify({ operation: "status", input: {} }))).status).toBe(
    401,
  );
  const replacement = JSON.stringify({
    origin: "http://127.0.0.1:1",
    pid: process.pid,
    nonce: NodeCrypto.randomBytes(18).toString("base64url"),
    protocolVersion: 1,
  });
  await NodeFSP.writeFile(NodePath.join(homeDir, "mcp-runtime.json"), replacement);
  await NodeFSP.chmod(NodePath.join(homeDir, "mcp-runtime.json"), 0o600);
  await host.close();
  expect(await NodeFSP.readFile(NodePath.join(homeDir, "mcp-runtime.json"), "utf8")).toBe(
    replacement,
  );
});

it("erases inherited native authority synchronously before service or CLI construction", async () => {
  const homeDir = await directory(),
    key = capability(),
    previous = process.env.HEADFUL_DESKTOP_CAPABILITY;
  process.env.HEADFUL_DESKTOP_CAPABILITY = key;
  const starting = startRuntimeHost(homeDir);
  expect(process.env.HEADFUL_DESKTOP_CAPABILITY).toBeUndefined();
  try {
    const host = await starting;
    hosts.push(host);
    expect(
      (await post(host.origin, JSON.stringify({ operation: "status", input: {} }), key)).status,
    ).toBe(200);
  } finally {
    if (previous === undefined) delete process.env.HEADFUL_DESKTOP_CAPABILITY;
    else process.env.HEADFUL_DESKTOP_CAPABILITY = previous;
  }
});

it("a failed service startup releases its ownership while preserving unique invalid storage", async () => {
  const homeDir = await directory(),
    blockedFile = NodePath.join(homeDir, "headful.sqlite");
  await NodeFSP.mkdir(blockedFile);
  await expect(startRuntimeHost(homeDir, { desktopCapability: capability() })).rejects.toThrow(
    "Unsafe Headful SQLite file",
  );
  await expect(NodeFSP.lstat(NodePath.join(homeDir, "runtime.lock"))).rejects.toThrow();
  expect((await NodeFSP.lstat(blockedFile)).isDirectory()).toBe(true);
  await NodeFSP.rmdir(blockedFile);
  const restarted = await startRuntimeHost(homeDir, { desktopCapability: capability() });
  hosts.push(restarted);
  expect(restarted.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
});
