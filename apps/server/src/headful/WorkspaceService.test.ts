import type { HeadfulModDefinition } from "../../../../packages/contracts/src/headful-mods.ts";
import type { HeadfulAuthority } from "../../../../packages/contracts/src/headful.ts";
import { currentIso } from "./domain/security.ts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
// @effect-diagnostics-next-line nodeBuiltinImport:off - isolated temporary fixture files, never live Salesforce or Headful data.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off - isolated temporary fixture files, never live Salesforce or Headful data.
import * as NodePath from "node:path";
import { makeHeadfulRuntime } from "./WorkspaceService.ts";
import { LocalStore } from "./Store.ts";
import { CliAdapter } from "./SalesforceCli.ts";
import {
  workflowSchema,
  userDraftSchema,
} from "../../../../packages/contracts/src/headful-workspace/user-schema.ts";
import {
  permissionProposalSchema,
  preparedPermissionSchema,
} from "../../../../packages/contracts/src/headful-workspace/ui-schema.ts";
import { reviewCapabilitySchema } from "../../../../packages/contracts/src/headful-workspace/workflow-schema.ts";
const adminId = "005000000000001",
  createdId = "005000000000002",
  profileId = "00e000000000001",
  licenseId = "100000000000001",
  set1 = "0PS000000000001",
  set2 = "0PS000000000002";
const allScopes = [
  "headful:read",
  "headful:propose",
  "headful:users",
  "headful:access",
  "headful:permissions",
];
const draft = userDraftSchema.parse({
  FirstName: "Maya",
  LastName: "Chen",
  Email: "maya@example.com",
  Username: "maya.headful@example.com",
  Alias: "mchen",
  ProfileId: profileId,
  TimeZoneSidKey: "America/Los_Angeles",
  LocaleSidKey: "en_US",
  LanguageLocaleKey: "en_US",
  EmailEncodingKey: "UTF-8",
  IsActive: true,
});
function provider(sfOrgId: string) {
  const defaults = {
    TimeZoneSidKey: "America/Los_Angeles",
    LocaleSidKey: "en_US",
    LanguageLocaleKey: "en_US",
    EmailEncodingKey: "UTF-8",
  };
  const current = {
    Id: adminId,
    FirstName: "Admin",
    LastName: "User",
    Email: "admin@example.com",
    Username: "admin@example.com",
    Alias: "admin",
    ProfileId: profileId,
    IsActive: true,
    ...defaults,
    CommunityNickname: "admin",
    Title: null,
    Department: null,
    Phone: null,
    CreatedDate: "2026-01-01T00:00:00.000Z",
    Profile: { Name: "Standard User", UserLicenseId: licenseId },
  };
  const state = {
    created: null as typeof current | null,
    assignments: [] as Array<{
      Id: string;
      AssigneeId: string;
      PermissionSetId: string;
      PermissionSet: { Name: string; Label: string };
    }>,
    calls: [] as string[],
    userOutcome: "success" as "success" | "timeout" | "rejected" | "readback-denied",
    failSet: null as string | null,
    unknownSet: null as string | null,
    licenseUsed: 1,
    profileLicense: licenseId,
    unsupportedRequired: false,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input),
        soql = url.searchParams.get("q") ?? "";
      state.calls.push((init.method ?? "GET") + " " + url.pathname);
      if (init.method === "POST" && url.pathname.endsWith("/sobjects/User")) {
        if (state.userOutcome === "rejected") return new Response("[]", { status: 403 });
        const sent = JSON.parse(String(init.body));
        state.created = { ...current, ...sent, Id: createdId, CreatedDate: currentIso() };
        if (state.userOutcome === "timeout") throw new Error("uncertain after provider accepted");
        return Response.json({ id: createdId, success: true, errors: [] });
      }
      if (init.method === "POST" && url.pathname.endsWith("/sobjects/PermissionSetAssignment")) {
        const sent = JSON.parse(String(init.body));
        if (state.failSet === sent.PermissionSetId) return new Response("[]", { status: 400 });
        const id = "0Pa" + String(state.assignments.length + 1).padStart(12, "0");
        state.assignments.push({
          Id: id,
          ...sent,
          PermissionSet: { Name: "Set", Label: "Permission set" },
        });
        if (state.unknownSet === sent.PermissionSetId)
          throw new Error("uncertain assignment response");
        return Response.json({ id, success: true });
      }
      if (init.method === "DELETE") {
        state.assignments = state.assignments.filter((a) => !url.pathname.endsWith("/" + a.Id));
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith("/User/describe")) {
        const fields = Object.entries(draft).map(([name, value]) => ({
          name,
          label: name,
          type: typeof value === "boolean" ? "boolean" : "string",
          length: name === "Alias" ? 8 : 100,
          createable: true,
          nillable: name === "FirstName" || name === "IsActive",
          defaultedOnCreate: false,
          defaultValue: null,
          picklistValues: defaults[name as keyof typeof defaults]
            ? [{ active: true, defaultValue: true, label: String(value), value: String(value) }]
            : [],
        }));
        if (state.unsupportedRequired)
          fields.push({
            name: "Required_Secret__c",
            label: "Required extra",
            type: "string",
            length: 100,
            createable: true,
            nillable: false,
            defaultedOnCreate: false,
            defaultValue: null,
            picklistValues: [],
          });
        return Response.json({ name: "User", createable: true, fields });
      }
      let records: unknown[] = [];
      if (soql.includes(" FROM Profile "))
        records = [{ Id: profileId, Name: "Standard User", UserLicenseId: state.profileLicense }];
      else if (soql.includes(" FROM UserLicense "))
        records = [
          {
            Id: licenseId,
            Name: "Salesforce",
            TotalLicenses: 10,
            UsedLicenses: state.licenseUsed,
            Status: "Active",
          },
        ];
      else if (soql.includes(" FROM Organization "))
        records = [{ Id: sfOrgId, Name: "Acme Sandbox", IsSandbox: true }];
      else if (soql.includes(" FROM PermissionSetAssignment ")) records = state.assignments;
      else if (soql.includes(" FROM PermissionSetLicenseAssign ")) records = [];
      else if (soql.includes(" FROM PermissionSet ")) {
        expect(soql).not.toContain("UserLicenseId");
        records = [set1, set2].map((Id) => ({
          Id,
          Name: "Set",
          Label: "Permission set",
          Description: null,
          IsOwnedByProfile: false,
          LicenseId: state.profileLicense,
        }));
      } else if (soql.includes(" FROM User ")) {
        if (soql.includes("Id='" + adminId + "'")) records = [current];
        else if (soql.includes("Username=")) {
          records = state.created ? [state.created] : [];
        } else {
          if (state.userOutcome === "readback-denied") return new Response("[]", { status: 403 });
          records = state.created ? [state.created] : [];
        }
      } else throw new Error("Unexpected provider query " + soql);
      return Response.json({ totalSize: records.length, done: true, records });
    }),
  );
  return state;
}

const desktop = { kind: "desktop" as const };
const mcpModFixture: HeadfulModDefinition = {
  nativeTrusted: true,
  hostPermissions: [],
  manifest: {
    schemaVersion: 1,
    execution: "native",
    apiVersion: 1,
    id: "headful.mcp-apps",
    name: "Fixture MCP",
    description: "Test-only mod feature gates.",
    version: "1.0.0",
    license: "MIT",
    source: "bundled",
    defaultEnabled: true,
    contributions: {
      features: [
        {
          id: "local-mcp",
          name: "Local MCP",
          description: "Fixture gate.",
          defaultEnabled: true,
          dependencies: ["org-management"],
          route: "integrations",
        },
        {
          id: "external-harness",
          name: "External harness",
          description: "Fixture gate.",
          defaultEnabled: true,
          dependencies: ["local-mcp"],
          route: "integrations",
        },
      ],
    },
  },
  activate: async () => ({ dispose() {} }),
};
const connectModFixture: HeadfulModDefinition = {
  nativeTrusted: true,
  hostPermissions: ["salesforce:read", "local:remote-transport"],
  manifest: {
    schemaVersion: 1,
    execution: "native",
    apiVersion: 1,
    id: "headful.connect-desktop",
    name: "Fixture remote connection",
    description: "Trusted remote fixture.",
    version: "1.0.0",
    license: "MIT",
    source: "bundled",
    defaultEnabled: true,
    permissions: ["salesforce:read", "local:remote-transport"],
    contributions: {
      features: [
        {
          id: "headful.connect-desktop/remote-access",
          name: "Remote access",
          description: "Fixture remote gate.",
          defaultEnabled: true,
          dependencies: ["org-management"],
          route: "mods",
        },
      ],
    },
  },
  activate: async () => ({ dispose() {} }),
};
function setup() {
  const folder = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "headful-domain-"));
  const store = new LocalStore(folder);
  const orgId = "fictional_org_0001",
    salesforceOrgId = "00D000000000001";
  store.db
    .prepare(
      `INSERT INTO orgs(id,application_id,label,salesforce_org_id,salesforce_user_id,instance_origin,username,alias,color,agent_enabled,is_sandbox,organization_name,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,1,1,'Fictional Sandbox','connected',?)`,
    )
    .run(
      orgId,
      orgId,
      "Fictional Sandbox",
      salesforceOrgId,
      adminId,
      "https://fictional.my.salesforce.com",
      "admin@example.com",
      "fictional",
      "#626dd2",
      1,
    );
  const cli = new CliAdapter();
  vi.spyOn(cli, "session").mockResolvedValue({
    orgId: salesforceOrgId,
    username: "admin@example.com",
    instanceOrigin: "https://fictional.my.salesforce.com",
    userId: adminId,
    accessToken: "fixture-server-only-token",
  });
  const runtime = makeHeadfulRuntime({
    homeDir: folder,
    store,
    cli,
    mods: [mcpModFixture, connectModFixture],
  });
  const agent = {
    kind: "mcp" as const,
    clientId: "fictional_client_1",
    orgIds: [orgId],
    scopes: allScopes,
  };
  const salesforce = provider(salesforceOrgId);
  return {
    folder,
    store,
    cli,
    runtime,
    orgId,
    salesforce,
    agent,
    async close() {
      await runtime.close();
      NodeFS.rmSync(folder, { recursive: true, force: true });
    },
  };
}
async function prepare(c: ReturnType<typeof setup>, authority: HeadfulAuthority = desktop) {
  const initial = workflowSchema.parse(
    await c.runtime.dispatch("prepareUserCreation", { orgId: c.orgId }, authority),
  );
  return workflowSchema.parse(
    await c.runtime.dispatch(
      "saveUserDraft",
      { workflowId: initial.id, revision: initial.revision, draft },
      authority,
    ),
  );
}
async function approve(
  c: ReturnType<typeof setup>,
  workflow: ReturnType<typeof workflowSchema.parse>,
) {
  return reviewCapabilitySchema.parse(
    await c.runtime.dispatch(
      "reviewWorkflow",
      { workflowId: workflow.id, revision: workflow.revision, digest: workflow.digest },
      desktop,
    ),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("local Salesforce service authority and durable reviewed changes", () => {
  it("works with no account, preserves defaults/features, and filters current org grants without exposing CLI secrets", async () => {
    const c = setup();
    try {
      const status = await c.runtime.dispatch("status", {}, desktop);
      expect(c.salesforce.calls).toHaveLength(0);
      await expect(
        c.runtime.dispatch(
          "inspectUser",
          { orgId: c.orgId, userId: adminId },
          { ...c.agent, scopes: ["headful:users"] },
        ),
      ).rejects.toMatchObject({ code: "scope" });
      expect(c.salesforce.calls).toHaveLength(0);
      expect(status).toMatchObject({ accountRequired: false, local: true });
      expect(JSON.stringify(status)).not.toContain("fixture-server-only-token");
      await c.runtime.dispatch("orgs.default", { orgId: c.orgId }, desktop);
      expect(c.store.preference("defaultOrgId", null)).toBe(c.orgId);
      await expect(c.runtime.dispatch("listOrgs", {}, c.agent)).resolves.toMatchObject({
        orgs: [{ id: c.orgId }],
      });
      await c.runtime.dispatch("orgs.update", { orgId: c.orgId, agentEnabled: false }, desktop);
      await expect(c.runtime.dispatch("listOrgs", {}, c.agent)).resolves.toEqual({ orgs: [] });
      await expect(
        c.runtime.dispatch("inspectUser", { orgId: c.orgId, userId: adminId }, c.agent),
      ).rejects.toMatchObject({ code: "org_disabled" });
      await c.runtime.dispatch("features.set", { id: "local-mcp", enabled: false }, desktop);
      await expect(c.runtime.dispatch("listOrgs", {}, c.agent)).rejects.toMatchObject({
        code: "feature_disabled",
      });
      expect(c.store.preference("features", {})).toMatchObject({
        "local-mcp": false,
        "external-harness": false,
      });
    } finally {
      await c.close();
    }
  });
  it("allows agent preparation but only a human desktop review executes exactly one user creation", async () => {
    const c = setup();
    try {
      const workflow = await prepare(c, c.agent);
      await expect(
        c.runtime.dispatch(
          "reviewWorkflow",
          { workflowId: workflow.id, revision: workflow.revision, digest: workflow.digest },
          c.agent,
        ),
      ).rejects.toMatchObject({ code: "desktop_required" });
      const review = await approve(c, workflow);
      const input = {
        workflowId: review.workflowId,
        revision: review.revision,
        digest: review.digest,
        approvalToken: review.approvalToken,
      };
      await expect(c.runtime.dispatch("createUser", input, c.agent)).rejects.toMatchObject({
        code: "desktop_required",
      });
      const results = await Promise.allSettled([
        c.runtime.dispatch("createUser", input, desktop),
        c.runtime.dispatch("createUser", input, desktop),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        c.salesforce.calls.filter((call) => call === "POST /services/data/v67.0/sobjects/User"),
      ).toHaveLength(1);
      expect(
        workflowSchema.parse(
          await c.runtime.dispatch("getWorkflow", { workflowId: workflow.id }, desktop),
        ),
      ).toMatchObject({ status: "access_pending", recordId: createdId });
      await expect(c.runtime.dispatch("createUser", input, desktop)).rejects.toMatchObject({
        code: "review_stale",
      });
      expect(
        JSON.stringify(c.store.db.prepare("SELECT * FROM workflow_reviews").get()),
      ).not.toContain(review.approvalToken);
    } finally {
      await c.close();
    }
  });
  it("pins approval to revision and connection and never retries an unknown creation", async () => {
    const c = setup();
    try {
      let workflow = await prepare(c),
        review = await approve(c, workflow);
      await c.runtime.dispatch(
        "saveUserDraft",
        {
          workflowId: workflow.id,
          revision: workflow.revision,
          draft: { ...draft, Alias: "mayac" },
        },
        desktop,
      );
      await expect(
        c.runtime.dispatch(
          "createUser",
          {
            workflowId: review.workflowId,
            revision: review.revision,
            digest: review.digest,
            approvalToken: review.approvalToken,
          },
          desktop,
        ),
      ).rejects.toMatchObject({ code: "review_stale" });
      workflow = workflowSchema.parse(
        await c.runtime.dispatch("getWorkflow", { workflowId: workflow.id }, desktop),
      );
      review = await approve(c, workflow);
      c.store.db
        .prepare("UPDATE orgs SET connection_version=connection_version+1 WHERE id=?")
        .run(c.orgId);
      await expect(
        c.runtime.dispatch(
          "createUser",
          {
            workflowId: review.workflowId,
            revision: review.revision,
            digest: review.digest,
            approvalToken: review.approvalToken,
          },
          desktop,
        ),
      ).rejects.toMatchObject({ code: "connection_changed" });
      workflow = await prepare(c);
      review = await approve(c, workflow);
      c.salesforce.userOutcome = "timeout";
      const input = {
        workflowId: review.workflowId,
        revision: review.revision,
        digest: review.digest,
        approvalToken: review.approvalToken,
      };
      await expect(c.runtime.dispatch("createUser", input, desktop)).rejects.toMatchObject({
        code: "execution_unknown",
      });
      await expect(c.runtime.dispatch("createUser", input, desktop)).rejects.toMatchObject({
        code: "review_stale",
      });
      expect(c.salesforce.calls.filter((call) => call.startsWith("POST"))).toHaveLength(1);
      c.salesforce.created!.Alias = "mchen";
      expect(
        workflowSchema.parse(
          await c.runtime.dispatch("reconcileUser", { workflowId: workflow.id }, desktop),
        ),
      ).toMatchObject({ status: "access_pending", recordId: createdId });
    } finally {
      await c.close();
    }
  });
  it("keeps created users and confirmed assignment receipts through a partial failure and a newly reviewed correction", async () => {
    const c = setup();
    try {
      let workflow = await prepare(c),
        review = await approve(c, workflow);
      workflow = workflowSchema.parse(
        await c.runtime.dispatch(
          "createUser",
          {
            workflowId: review.workflowId,
            revision: review.revision,
            digest: review.digest,
            approvalToken: review.approvalToken,
          },
          desktop,
        ),
      );
      workflow = workflowSchema.parse(
        await c.runtime.dispatch(
          "prepareUserAccess",
          {
            workflowId: workflow.id,
            revision: workflow.revision,
            addPermissionSetIds: [set1, set2],
            removeAssignmentIds: [],
          },
          desktop,
        ),
      );
      review = await approve(c, workflow);
      c.salesforce.failSet = set2;
      workflow = workflowSchema.parse(
        await c.runtime.dispatch(
          "applyUserAccess",
          {
            workflowId: review.workflowId,
            revision: review.revision,
            digest: review.digest,
            approvalToken: review.approvalToken,
          },
          desktop,
        ),
      );
      expect(workflow).toMatchObject({
        status: "partial",
        recordId: createdId,
        accessProposal: { operations: [{ status: "verified" }, { status: "failed" }] },
      });
      c.salesforce.failSet = null;
      workflow = workflowSchema.parse(
        await c.runtime.dispatch(
          "prepareUserAccess",
          {
            workflowId: workflow.id,
            revision: workflow.revision,
            addPermissionSetIds: [set2],
            removeAssignmentIds: [],
          },
          desktop,
        ),
      );
      expect(workflow.operationHistory.map((o) => o.status)).toEqual(["verified", "failed"]);
      review = await approve(c, workflow);
      expect(
        workflowSchema.parse(
          await c.runtime.dispatch(
            "applyUserAccess",
            {
              workflowId: review.workflowId,
              revision: review.revision,
              digest: review.digest,
              approvalToken: review.approvalToken,
            },
            desktop,
          ),
        ).status,
      ).toBe("completed");
      expect(
        c.salesforce.calls.filter((call) => call === "POST /services/data/v67.0/sobjects/User"),
      ).toHaveLength(1);
    } finally {
      await c.close();
    }
  });
});
function permissionProvider() {
  const date = "2026-10-04T12:00:00.000Z";
  const state = {
    set: {
      Id: set1,
      Name: "Fictional_Set",
      Label: "Original",
      Description: null as string | null,
      IsOwnedByProfile: false,
      IsCustom: true,
      NamespacePrefix: null,
      LastModifiedDate: date,
    },
    writes: 0,
    timeout: false,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      if (init.method === "PATCH") {
        state.writes++;
        Object.assign(state.set, JSON.parse(String(init.body)), {
          LastModifiedDate: "2026-10-04T12:01:00.000Z",
        });
        if (state.timeout) throw new Error("Provider accepted, response unknown");
        return new Response(null, { status: 204 });
      }
      const soql = url.searchParams.get("q") ?? "";
      const records = soql.includes(" FROM PermissionSet ") ? [state.set] : [];
      return Response.json({ totalSize: records.length, done: true, records });
    }),
  );
  return state;
}
describe("local permission-set review safety", () => {
  it("requires a human single-use review, preserves unrelated metadata, and rejects stale snapshots before dispatch", async () => {
    const c = setup(),
      p = permissionProvider();
    try {
      let proposal = preparedPermissionSchema.parse(
        await c.runtime.dispatch(
          "preparePermissionChange",
          {
            orgId: c.orgId,
            permissionSetId: set1,
            change: { kind: "details", label: "Reviewed", description: "Exact update" },
          },
          c.agent,
        ),
      );
      await expect(
        c.runtime.dispatch(
          "reviewPermissionProposal",
          { proposalId: proposal.id, digest: proposal.digest },
          c.agent,
        ),
      ).rejects.toMatchObject({ code: "desktop_required" });
      let review = reviewCapabilitySchema.parse(
        await c.runtime.dispatch(
          "reviewPermissionProposal",
          { proposalId: proposal.id, digest: proposal.digest },
          desktop,
        ),
      );
      p.set.Description = "Changed outside Headful";
      await expect(
        c.runtime.dispatch(
          "applyPermissionProposal",
          { proposalId: proposal.id, digest: proposal.digest, approvalToken: review.approvalToken },
          desktop,
        ),
      ).rejects.toMatchObject({ code: "stale" });
      expect(p.writes).toBe(0);
      proposal = preparedPermissionSchema.parse(
        await c.runtime.dispatch(
          "preparePermissionChange",
          {
            orgId: c.orgId,
            permissionSetId: set1,
            change: { kind: "details", label: "Reviewed", description: "Exact update" },
          },
          desktop,
        ),
      );
      review = reviewCapabilitySchema.parse(
        await c.runtime.dispatch(
          "reviewPermissionProposal",
          { proposalId: proposal.id, digest: proposal.digest },
          desktop,
        ),
      );
      const input = {
        proposalId: proposal.id,
        digest: proposal.digest,
        approvalToken: review.approvalToken,
      };
      const outcomes = await Promise.allSettled([
        c.runtime.dispatch("applyPermissionProposal", input, desktop),
        c.runtime.dispatch("applyPermissionProposal", input, desktop),
      ]);
      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(p.writes).toBe(1);
      expect(
        permissionProposalSchema.parse(
          await c.runtime.dispatch("getPermissionProposal", { proposalId: proposal.id }, desktop),
        ),
      ).toMatchObject({
        status: "completed",
        result: {
          authority: "provider-receipt-and-readback",
          readback: { Name: "Fictional_Set", Label: "Reviewed" },
        },
      });
    } finally {
      await c.close();
    }
  });
  it("records an unknown permission-write outcome and refuses duplicate execution after timeout", async () => {
    const c = setup(),
      p = permissionProvider();
    try {
      const proposal = preparedPermissionSchema.parse(
        await c.runtime.dispatch(
          "preparePermissionChange",
          {
            orgId: c.orgId,
            permissionSetId: set1,
            change: { kind: "details", label: "Uncertain", description: "" },
          },
          desktop,
        ),
      );
      const review = reviewCapabilitySchema.parse(
          await c.runtime.dispatch(
            "reviewPermissionProposal",
            { proposalId: proposal.id, digest: proposal.digest },
            desktop,
          ),
        ),
        input = {
          proposalId: proposal.id,
          digest: proposal.digest,
          approvalToken: review.approvalToken,
        };
      p.timeout = true;
      await expect(
        c.runtime.dispatch("applyPermissionProposal", input, desktop),
      ).rejects.toMatchObject({ code: "execution_unknown" });
      expect(
        permissionProposalSchema.parse(
          await c.runtime.dispatch("getPermissionProposal", { proposalId: proposal.id }, desktop),
        ).status,
      ).toBe("execution_unknown");
      await expect(
        c.runtime.dispatch("applyPermissionProposal", input, desktop),
      ).rejects.toMatchObject({ code: "proposal_unavailable" });
      expect(p.writes).toBe(1);
    } finally {
      await c.close();
    }
  });
});

describe("Connect authority shares the local org policy", () => {
  it("requires an independent remote opt-in, keeps explicit grant orgs and loses access immediately", async () => {
    const c = setup();
    try {
      const remote: HeadfulAuthority = { ...c.agent, source: "connect" };
      await c.runtime.dispatch("mods.disable", { id: "headful.mcp-apps" }, desktop);
      expect((await c.runtime.dispatch("listOrgs", {}, remote)).orgs).toEqual([]);
      await expect(
        c.runtime.dispatch("listPermissionSets", { orgId: c.orgId }, remote),
      ).rejects.toMatchObject({ code: "org_missing" });
      await c.runtime.dispatch(
        "orgs.update",
        { orgId: c.orgId, remoteEnabled: true, agentEnabled: false },
        desktop,
      );
      expect((await c.runtime.dispatch("listOrgs", {}, remote)).orgs.map((org) => org.id)).toEqual([
        c.orgId,
      ]);
      expect((await c.runtime.dispatch("listOrgs", {}, { ...remote, orgIds: [] })).orgs).toEqual(
        [],
      );
      await expect(
        c.runtime.dispatch(
          "reviewPermissionProposal",
          { proposalId: "fictional_proposal_0001", digest: "a".repeat(43) },
          remote,
        ),
      ).rejects.toMatchObject({ code: "desktop_required" });
      await c.runtime.dispatch("orgs.update", { orgId: c.orgId, remoteEnabled: false }, desktop);
      expect((await c.runtime.dispatch("listOrgs", {}, remote)).orgs).toEqual([]);
      await expect(
        c.runtime.dispatch("listPermissionSets", { orgId: c.orgId }, remote),
      ).rejects.toMatchObject({ code: "org_missing" });
      await c.runtime.dispatch("mods.disable", { id: "headful.connect-desktop" }, desktop);
      await expect(c.runtime.dispatch("listOrgs", {}, remote)).rejects.toMatchObject({
        code: "mod_disabled",
      });
      expect((await c.runtime.dispatch("orgs.list", {}, desktop)).orgs).toHaveLength(1);
    } finally {
      await c.close();
    }
  });
  it("cannot turn remote routing into desktop human authority", async () => {
    const c = setup();
    try {
      await expect(
        c.runtime.dispatch("orgs.list", {}, { kind: "desktop", source: "connect" }),
      ).rejects.toMatchObject({ code: "authority_invalid" });
    } finally {
      await c.close();
    }
  });
});
