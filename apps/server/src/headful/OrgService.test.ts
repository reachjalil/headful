import { describe, expect, it, vi, afterEach } from "vite-plus/test";
// @effect-diagnostics-next-line nodeBuiltinImport:off - isolated temporary SQLite fixtures, never live Headful state.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off - isolated temporary paths.
import { join } from "node:path";
import { makeHeadfulRuntime } from "./WorkspaceService.ts";
import { CliAdapter } from "./SalesforceCli.ts";
const sfOrg = "00D000000000001",
  sfUser = "005000000000001",
  username = "fictional@example.com";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("verified Salesforce CLI org references", () => {
  it("verifies a missing CLI userId with Salesforce userinfo and persists identity, separate defaults, aliases and opt-in agent access", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "headful-org-fixture-"));
    const cli = new CliAdapter();
    vi.spyOn(cli, "session").mockResolvedValue({
      orgId: sfOrg,
      username,
      instanceOrigin: "https://fictional.my.salesforce.com",
      userId: null,
      accessToken: "fixture-private-token",
    });
    const logout = vi.spyOn(cli, "logout").mockResolvedValue({ loggedOut: true });
    let userinfoCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.pathname.endsWith("/userinfo")) {
          userinfoCalls++;
          return Response.json({
            user_id: sfUser,
            organization_id: sfOrg,
            preferred_username: username,
            privateProviderField: "never-forward",
          });
        }
        const query = url.searchParams.get("q") ?? "";
        const records = query.includes(" FROM Organization ")
          ? [{ Id: sfOrg, Name: "Fictional Production", IsSandbox: false }]
          : [{ Id: sfUser, Username: username }];
        return Response.json({ records });
      }),
    );
    let runtime = makeHeadfulRuntime({ homeDir, cli });
    try {
      const imported = await runtime.dispatch(
        "orgs.import",
        { username, alias: "Prod", color: "#626dd2" },
        { kind: "desktop" },
      );
      expect(imported).toMatchObject({
        salesforceOrgId: sfOrg,
        principalId: sfUser,
        agentEnabled: false,
        isDefault: true,
      });
      expect(userinfoCalls).toBe(1);
      const repeated = await runtime.dispatch("orgs.import", { username }, { kind: "desktop" });
      expect(repeated).toMatchObject({
        id: imported.id,
        connectionVersion: imported.connectionVersion,
      });
      vi.spyOn(cli, "login").mockResolvedValue({ username });
      const reconnected = await runtime.dispatch(
        "orgs.login",
        { environment: "production" },
        { kind: "desktop" },
      );
      expect(reconnected.connectionVersion).toBe(imported.connectionVersion + 1);
      expect(JSON.stringify(imported)).not.toContain("private");
      const updated = await runtime.dispatch(
        "orgs.update",
        { orgId: imported.id, alias: "Production", label: "Fictional CRM" },
        { kind: "desktop" },
      );
      expect(updated.orgs[0]).toMatchObject({
        id: imported.id,
        alias: "Production",
        salesforceOrgId: sfOrg,
        principalId: sfUser,
      });
      await runtime.close();
      runtime = makeHeadfulRuntime({ homeDir, cli });
      expect(await runtime.dispatch("orgs.list", {}, { kind: "desktop" })).toMatchObject({
        defaultOrgId: imported.id,
        orgs: [{ label: "Fictional CRM", alias: "Production" }],
      });
      await runtime.dispatch("orgs.remove", { orgId: imported.id }, { kind: "desktop" });
      expect(logout).not.toHaveBeenCalled();
      expect(await runtime.dispatch("orgs.list", {}, { kind: "desktop" })).toEqual({
        orgs: [],
        defaultOrgId: null,
      });
    } finally {
      await runtime.close();
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
  it("fails closed when the auth token belongs to another principal, before saving an org reference", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "headful-identity-fixture-"));
    const cli = new CliAdapter();
    vi.spyOn(cli, "session").mockResolvedValue({
      orgId: sfOrg,
      username,
      instanceOrigin: "https://fictional.my.salesforce.com",
      userId: null,
      accessToken: "fixture-private-token",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          user_id: sfUser,
          organization_id: sfOrg,
          preferred_username: "different@example.com",
        }),
      ),
    );
    const runtime = makeHeadfulRuntime({ homeDir, cli });
    try {
      await expect(
        runtime.dispatch("orgs.import", { username }, { kind: "desktop" }),
      ).rejects.toMatchObject({ code: "connection_changed" });
      expect(await runtime.dispatch("orgs.list", {}, { kind: "desktop" })).toEqual({
        orgs: [],
        defaultOrgId: null,
      });
      await expect(
        runtime.dispatch(
          "orgs.logout",
          { orgId: "fictional_org_0001", confirmLogout: false },
          { kind: "desktop" },
        ),
      ).rejects.toThrow();
    } finally {
      await runtime.close();
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
