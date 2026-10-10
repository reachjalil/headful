// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalDate:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, it, expect, vi } from "vite-plus/test";
const fake = vi.hoisted(() => ({
  answer: 0,
  show: vi.fn(),
  handlers: new Map<string, unknown>(),
  windows: [] as unknown[],
}));
vi.mock("electron", () => ({
  app: { getVersion: () => "test" },
  BrowserWindow: { getAllWindows: () => fake.windows },
  dialog: {
    showMessageBox: async (options: unknown) => {
      fake.show(options);
      return { response: fake.answer };
    },
  },
  ipcMain: {
    handle: (name: string, fn: unknown) => fake.handlers.set(name, fn),
    removeHandler: (name: string) => fake.handlers.delete(name),
  },
}));
import { startDesktopControl } from "./DesktopControl.ts";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  fake.answer = 0;
  fake.show.mockClear();
  vi.restoreAllMocks();
});
async function start(dev: boolean) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "headful-control-test-"));
  const control = await startDesktopControl(dir, dev);
  cleanup.push(async () => {
    await control.close();
    await NodeFSP.rm(dir, { recursive: true, force: true });
  });
  const file = NodePath.join(dir, "desktop-control.json");
  const session = JSON.parse(await NodeFSP.readFile(file, "utf8")) as {
    origin: string;
    bootstrap: string;
  };
  const request = (route: string, data: unknown, headers: Record<string, string> = {}) =>
    fetch(session.origin + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(data),
    });
  const pair = async (scopes: string[]) => {
    const response = await request(
      "/pair",
      { client: "Test client", scopes },
      { "X-Headful-Bootstrap": session.bootstrap },
    );
    return { response, grant: (await response.json()) as { token?: string } };
  };
  return { control, session, request, pair, file };
}
describe("native control authorization", () => {
  it("requires the protected bootstrap plus explicit native consent, and denies browser origins", async () => {
    const { request, pair, file } = await start(true);
    expect((await NodeFSP.stat(file)).mode & 0o077).toBe(0);
    expect((await request("/pair", { client: "Attacker", scopes: ["diagnostics"] })).status).toBe(
      401,
    );
    expect(fake.show).not.toHaveBeenCalled();
    const denied = await pair(["diagnostics"]);
    expect(denied.response.status).toBe(401);
    expect(denied.grant.token).toBeUndefined();
    expect(fake.show.mock.calls[0]?.[0]).toMatchObject({
      buttons: ["Deny", "Authorize"],
      defaultId: 0,
      cancelId: 0,
    });
    expect((await request("/mcp", {}, { Origin: "https://attacker.test" })).status).toBe(403);
  });
  it("revalidates grants on every request and limits packaged apps to diagnostics", async () => {
    const { request, pair, control } = await start(false);
    fake.answer = 1;
    expect((await pair(["capture"])).response.status).toBe(401);
    expect(fake.show).not.toHaveBeenCalled();
    const { grant } = await pair(["diagnostics"]);
    expect(grant.token).toBeTruthy();
    const headers = { Authorization: `Bearer ${grant.token}` };
    const rpc = (method: string, params?: object) =>
      request("/mcp", { jsonrpc: "2.0", id: 1, method, params }, headers);
    const list = (await (await rpc("tools/list")).json()) as {
      result: { tools: { name: string }[] };
    };
    expect(list.result.tools.map((tool) => tool.name)).toEqual(["desktop_diagnostics"]);
    const result = await (
      await rpc("tools/call", { name: "desktop_diagnostics", arguments: {} })
    ).json();
    expect(JSON.stringify(result)).toContain("App inspection only");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3_600_001);
    expect((await rpc("tools/list")).status).toBe(401);
    vi.restoreAllMocks();
    control.revoke();
    expect((await rpc("tools/list")).status).toBe(401);
  });
});
