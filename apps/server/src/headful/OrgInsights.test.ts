// @effect-diagnostics nodeBuiltinImport:off
import { afterEach, expect, it, vi } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { CliAdapter } from "./SalesforceCli.ts";
import { makeHeadfulRuntime } from "./WorkspaceService.ts";
import { LocalStore } from "./Store.ts";
import { requireOrg } from "./domain/salesforce.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("requires exact folder scope and refuses unadvertised metadata types before listing components", async () => {
  const f = await fixture();
  try {
    for (const input of [{ type: "Report" }, { type: "CustomObject", folder: "unfiled$public" }])
      await expect(
        f.runtime.dispatch(
          "orgs.metadata.components",
          { orgId: f.org.id, ...input },
          { kind: "desktop" },
        ),
      ).rejects.toMatchObject({ code: "metadata_folder_scope" });
    await expect(
      f.runtime.dispatch(
        "orgs.metadata.components",
        { orgId: f.org.id, type: "UnknownType" },
        { kind: "desktop" },
      ),
    ).rejects.toMatchObject({ code: "metadata_type_unavailable" });
    expect(f.components).not.toHaveBeenCalled();
    f.components.mockResolvedValue([
      { fullName: "SalesFolder/Weekly_Report", namespacePrefix: "pkg" },
    ]);
    expect(
      await f.runtime.dispatch(
        "orgs.metadata.components",
        { orgId: f.org.id, type: "Report", folder: "SalesFolder" },
        { kind: "desktop" },
      ),
    ).toMatchObject({
      folder: "SalesFolder",
      components: [{ name: "SalesFolder/Weekly_Report", namespace: "pkg" }],
    });
    expect(f.components).toHaveBeenCalledWith(identity.username, "Report", "SalesFolder");
  } finally {
    await f.close();
  }
});
const identity = {
  orgId: "00D000000000001",
  userId: "005000000000001",
  username: "test@example.com",
  instanceOrigin: "https://fixture.my.salesforce.com",
  accessToken: "private-fixture-token",
};
async function fixture() {
  const cli = new CliAdapter();
  const session = vi.spyOn(cli, "session").mockResolvedValue(identity);
  vi.spyOn(cli, "discover").mockResolvedValue({
    bounded: true,
    connections: [
      {
        orgId: identity.orgId,
        username: identity.username,
        environment: "scratch",
        expirationDate: "2026-10-10",
      },
    ],
  });
  const limits = vi
    .spyOn(cli, "utilityLimits")
    .mockResolvedValue([
      { name: "DailyApiRequests", max: 100, remaining: 20, accessToken: "never-forward" },
    ]);
  const metadata = vi.spyOn(cli, "metadataTypes").mockResolvedValue({
    metadataObjects: [
      {
        xmlName: "CustomObject",
        directoryName: "objects",
        suffix: "object",
        inFolder: false,
        childXmlNames: ["CustomField"],
        privateField: "never-forward",
      },
      { xmlName: "Report", directoryName: "reports", suffix: "report", inFolder: true },
    ],
  });
  const components = vi.spyOn(cli, "metadataComponents").mockResolvedValue(
    Array.from({ length: 501 }, (_, i) => ({
      fullName: `Object_${i}__c`,
      lastModifiedDate: "2026-10-06T00:00:00Z",
      lastModifiedByName: "Fictional Admin",
      manageableState: "unmanaged",
      privateField: "never-forward",
    })),
  );
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(init?.method ?? "GET").toBe("GET");
    const url = new URL(String(input));
    const query = url.searchParams.get("q") ?? "";
    if (url.pathname.endsWith("/UserLicense/describe"))
      return Response.json({
        fields: [{ name: "MonthlyLoginsEntitlement" }, { name: "MonthlyLoginsUsed" }],
      });
    if (query.includes("FROM UserLicense"))
      return Response.json({
        done: true,
        records: [
          {
            Id: "100000000000001",
            Name: "Salesforce",
            MasterLabel: "Salesforce",
            Status: "Active",
            TotalLicenses: 5,
            UsedLicenses: 7,
            UsedLicensesLastUpdated: "2026-10-07T00:00:00Z",
            MonthlyLoginsEntitlement: null,
            MonthlyLoginsUsed: null,
            privateField: "never-forward",
          },
          {
            Id: "100000000000002",
            Name: "Customer Community Login",
            TotalLicenses: 1000,
            UsedLicenses: 400,
            MonthlyLoginsEntitlement: 100,
            MonthlyLoginsUsed: 85,
          },
        ],
      });
    if (query.includes("FROM PermissionSetLicense"))
      return Response.json({
        done: true,
        records: [
          {
            Id: "0PL000000000001",
            MasterLabel: "Feature trial",
            DeveloperName: "FeatureTrial",
            Status: "Disabled",
            TotalLicenses: 0,
            UsedLicenses: 0,
            ExpirationDate: "2026-09-01",
          },
        ],
      });
    if (query.includes("FROM PackageLicense"))
      return Response.json({
        done: true,
        records: [
          {
            Id: "050000000000001",
            NamespacePrefix: "fixture_package",
            Status: "Free",
            AllowedLicenses: -1,
            UsedLicenses: 0,
            ExpirationDate: null,
          },
        ],
      });
    if (query.includes("SandboxProcess"))
      return Response.json({
        done: true,
        records: [
          {
            SandboxInfoId: "0GQ000000000001",
            Status: "Processing",
            CopyProgress: 62,
            CreatedDate: "2026-10-07T00:00:00Z",
            EndDate: null,
          },
          {
            SandboxInfoId: "0GQ000000000001",
            Status: "Completed",
            CopyProgress: 100,
            CreatedDate: "2026-10-01T00:00:00Z",
            EndDate: "2026-10-01T01:00:00Z",
          },
        ],
      });
    if (query.includes("SandboxInfo"))
      return Response.json({
        done: true,
        records: [
          {
            Id: "0GQ000000000001",
            SandboxName: "dev",
            Description: null,
            LicenseType: "Developer",
          },
        ],
      });
    if (query.includes("InstanceName"))
      return Response.json({
        records: [
          {
            Id: identity.orgId,
            OrganizationType: "Developer Edition",
            InstanceName: "NA999",
            NamespacePrefix: null,
            TrialExpirationDate: null,
          },
        ],
      });
    return Response.json({
      records: query.includes("Organization")
        ? [{ Id: identity.orgId, Name: "Fixture Org", IsSandbox: false }]
        : [{ Id: identity.userId, Username: identity.username }],
    });
  });
  vi.stubGlobal("fetch", fetch);
  const homeDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "headful-insights-"));
  const store = new LocalStore(homeDir);
  const runtime = makeHeadfulRuntime({ homeDir, cli, store });
  const org = await runtime.dispatch(
    "orgs.import",
    { username: identity.username },
    { kind: "desktop" },
  );
  return {
    runtime,
    store,
    cli,
    org,
    session,
    limits,
    metadata,
    components,
    fetch,
    close: async () => {
      await runtime.close();
      NodeFS.rmSync(homeDir, { recursive: true, force: true });
    },
  };
}

it("returns credential-safe, bounded org facts, metadata and the latest sandbox copy without provider writes", async () => {
  const f = await fixture();
  try {
    const input = { orgId: f.org.id };
    const overview = await f.runtime.dispatch("orgs.overview", input, { kind: "desktop" });
    expect(overview).toMatchObject({
      environment: "scratch",
      expirationDate: "2026-10-10",
      edition: "Developer Edition",
    });
    const limits = await f.runtime.dispatch("orgs.limits", input, { kind: "desktop" });
    expect(limits.limits).toEqual([{ name: "DailyApiRequests", max: 100, remaining: 20 }]);
    expect(f.limits).toHaveBeenCalledWith(identity.username);
    expect(await f.runtime.dispatch("orgs.metadata", input, { kind: "desktop" })).toMatchObject({
      apiVersion: "67.0",
      types: [
        { name: "CustomObject", childTypes: ["CustomField"] },
        { name: "Report", inFolder: true },
      ],
    });
    const components = await f.runtime.dispatch(
      "orgs.metadata.components",
      { ...input, type: "Report", folder: "unfiled$public" },
      { kind: "desktop" },
    );
    expect(components.components).toHaveLength(500);
    expect(components.capped).toBe(true);
    expect(components).toMatchObject({
      apiVersion: "67.0",
      folder: "unfiled$public",
      completeness: "not-guaranteed",
      returnedCount: 501,
    });
    expect(f.components).toHaveBeenCalledWith(identity.username, "Report", "unfiled$public");
    expect(JSON.stringify([overview, limits, components])).not.toContain("private");
    const env = await f.runtime.dispatch("orgs.environments", input, { kind: "desktop" });
    expect(env.sandboxes[0]).toMatchObject({
      status: "Processing",
      progress: 62,
      completedAt: null,
    });
    expect(
      f.fetch.mock.calls.every(([url]) => String(url).startsWith(identity.instanceOrigin)),
    ).toBe(true);
  } finally {
    await f.close();
  }
});

it("reads separate license inventories, optional monthly consumption and unknown allowances without forwarding provider extras", async () => {
  const f = await fixture();
  try {
    f.session.mockClear();
    const result = await f.runtime.dispatch(
      "orgs.licenses",
      { orgId: f.org.id },
      { kind: "desktop" },
    );
    expect(result.monthlyLoginsAvailable).toBe(true);
    expect(result.groups.map((g) => g.kind)).toEqual(["user", "permission-set", "package"]);
    expect(result.groups[0]?.licenses[0]).toMatchObject({ name: "Salesforce", total: 5, used: 7 });
    expect(result.groups[0]?.licenses[1]?.monthlyLogins).toEqual({ total: 100, used: 85 });
    expect(result.groups[1]?.licenses[0]).toMatchObject({
      status: "Disabled",
      total: 0,
      used: 0,
      expiresAt: "2026-09-01",
    });
    expect(result.groups[2]?.licenses[0]).toMatchObject({ total: null, used: 0 });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("never-forward");
    const queries = f.fetch.mock.calls
      .map(([url]) => new URL(String(url)).searchParams.get("q") ?? "")
      .filter((q) => /FROM (UserLicense|PermissionSetLicense|PackageLicense)/.test(q));
    expect(queries).toHaveLength(3);
    expect(queries.every((q) => q.endsWith("LIMIT 501"))).toBe(true);
    expect(f.session).toHaveBeenCalledTimes(1);
  } finally {
    await f.close();
  }
});

it("keeps available license categories after a permission failure and excludes unavailable monthly fields from SOQL", async () => {
  const f = await fixture();
  const original = f.fetch.getMockImplementation()!;
  try {
    f.fetch.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const query = url.searchParams.get("q") ?? "";
      if (url.pathname.endsWith("/UserLicense/describe"))
        return Response.json({ fields: [{ name: "Name" }] });
      if (query.includes("FROM PermissionSetLicense"))
        return Response.json(
          [{ errorCode: "INSUFFICIENT_ACCESS", message: "private provider detail" }],
          { status: 403 },
        );
      if (query.includes("FROM UserLicense")) {
        expect(query).not.toContain("MonthlyLogins");
        return Response.json({
          done: false,
          records: Array.from({ length: 501 }, (_, i) => ({
            Id: `100${String(i).padStart(12, "0")}`,
            Name: `License ${i}`,
            TotalLicenses: 10,
            UsedLicenses: null,
          })),
        });
      }
      return original(input, init);
    });
    const result = await f.runtime.dispatch(
      "orgs.licenses",
      { orgId: f.org.id },
      { kind: "desktop" },
    );
    expect(result.monthlyLoginsAvailable).toBe(false);
    expect(result.groups[0]).toMatchObject({ availability: "available", capped: true });
    expect(result.groups[0]?.licenses).toHaveLength(500);
    expect(result.groups[0]?.licenses[0]?.used).toBeNull();
    expect(result.groups[1]).toEqual({
      kind: "permission-set",
      availability: "unavailable",
      capped: false,
      licenses: [],
    });
    expect(result.groups[2]?.availability).toBe("available");
    expect(JSON.stringify(result)).not.toContain("private");
  } finally {
    await f.close();
  }
});

it("does not disguise changed license-read identity as partial unavailability", async () => {
  const f = await fixture();
  try {
    f.fetch.mockClear();
    f.session.mockResolvedValue({ ...identity, userId: "005000000000002" });
    await expect(
      f.runtime.dispatch("orgs.licenses", { orgId: f.org.id }, { kind: "desktop" }),
    ).rejects.toMatchObject({ code: "connection_changed" });
    expect(f.fetch).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it("pins a license read to its verified identity and rejects a changed login on the next operation", async () => {
  const f = await fixture();
  const original = f.fetch.getMockImplementation()!;
  try {
    f.session.mockClear();
    f.fetch.mockImplementation(async (input, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer " + identity.accessToken,
      );
      if (String(input).endsWith("/UserLicense/describe"))
        f.session.mockResolvedValue({
          ...identity,
          userId: "005000000000002",
          accessToken: "changed-private-token",
        });
      return original(input, init);
    });
    const first = await f.runtime.dispatch(
      "orgs.licenses",
      { orgId: f.org.id },
      { kind: "desktop" },
    );
    expect(first.groups.every((group) => group.availability === "available")).toBe(true);
    expect(f.session).toHaveBeenCalledTimes(1);
    f.fetch.mockClear();
    await expect(
      f.runtime.dispatch("orgs.licenses", { orgId: f.org.id }, { kind: "desktop" }),
    ).rejects.toMatchObject({ code: "connection_changed" });
    expect(f.fetch).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it.each(["network", 408, 429, 500])(
  "fails unavailable provider %s instead of returning an empty license inventory",
  async (failure) => {
    const f = await fixture();
    try {
      if (failure === "network") f.fetch.mockRejectedValue(new Error("network unavailable"));
      else f.fetch.mockResolvedValue(new Response(null, { status: Number(failure) }));
      await expect(
        f.runtime.dispatch("orgs.licenses", { orgId: f.org.id }, { kind: "desktop" }),
      ).rejects.toMatchObject({ code: "provider_unavailable" });
    } finally {
      await f.close();
    }
  },
);

it("rejects changed principals and orgs before invoking metadata or limits CLI commands", async () => {
  const f = await fixture();
  try {
    f.session.mockResolvedValue({ ...identity, userId: "005000000000002" });
    await expect(
      f.runtime.dispatch("orgs.metadata", { orgId: f.org.id }, { kind: "desktop" }),
    ).rejects.toMatchObject({ code: "connection_changed" });
    f.session.mockResolvedValue({ ...identity, orgId: "00D000000000002" });
    await expect(
      f.runtime.dispatch("orgs.limits", { orgId: f.org.id }, { kind: "desktop" }),
    ).rejects.toMatchObject({ code: "connection_changed" });
    expect(f.metadata).not.toHaveBeenCalled();
    expect(f.limits).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it("keeps CLI expiry available when an expired org cannot answer API reads, without masking a changed identity", async () => {
  const f = await fixture();
  try {
    f.fetch.mockRejectedValue(new Error("expired provider"));
    const overview = await f.runtime.dispatch(
      "orgs.overview",
      { orgId: f.org.id },
      { kind: "desktop" },
    );
    expect(overview).toMatchObject({
      detailsAvailable: false,
      edition: null,
      environment: "scratch",
      expirationDate: "2026-10-10",
    });
    f.session.mockResolvedValue({ ...identity, userId: "005000000000002" });
    await expect(
      f.runtime.dispatch("orgs.overview", { orgId: f.org.id }, { kind: "desktop" }),
    ).rejects.toMatchObject({ code: "connection_changed" });
  } finally {
    await f.close();
  }
});

it("enforces disabled agent access, selected org authority and the org-management feature", async () => {
  const f = await fixture();
  try {
    const env = { DB: f.store, cli: f.cli };
    const principal = {
      kind: "mcp" as const,
      user: { id: "fixture-client" },
      scopes: ["headful:read"],
      orgIds: [f.org.id],
    };
    await expect(requireOrg(env, principal, f.org.id)).rejects.toMatchObject({
      code: "org_disabled",
    });
    await expect(requireOrg(env, { ...principal, orgIds: [] }, f.org.id)).rejects.toMatchObject({
      code: "org_missing",
    });
    await expect(
      f.runtime.dispatch(
        "orgs.limits",
        { orgId: f.org.id },
        { kind: "mcp", clientId: "fixture-client", scopes: ["headful:read"], orgIds: [f.org.id] },
      ),
    ).rejects.toMatchObject({ code: "feature_disabled" });
    await expect(
      f.runtime.dispatch(
        "orgs.metadata.components",
        { orgId: f.org.id, type: "CustomObject --evil" },
        { kind: "desktop" },
      ),
    ).rejects.toBeDefined();
    await expect(
      f.runtime.dispatch(
        "orgs.metadata.components",
        { orgId: f.org.id, type: "Report", folder: "--help" },
        { kind: "desktop" },
      ),
    ).rejects.toBeDefined();
    expect(f.components).not.toHaveBeenCalled();
    expect(f.limits).not.toHaveBeenCalled();
    await f.runtime.dispatch(
      "features.set",
      { id: "org-management", enabled: false },
      { kind: "desktop" },
    );
    await expect(
      f.runtime.dispatch("orgs.metadata", { orgId: f.org.id }, { kind: "desktop" }),
    ).rejects.toBeDefined();
    expect(f.metadata).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});
