import { describe, expect, it } from "vite-plus/test";
import type { HeadfulResult } from "@t3tools/contracts/headful";
import {
  headfulExtensionDescriptorSchema,
  type HeadfulExtensionDescriptor,
} from "@t3tools/contracts/headful-extensions";
import {
  buildNotifications,
  filterSearchEntries,
  type NotificationsInput,
  type SearchEntry,
} from "./command-center";

const orgId = "org_production_001";
const workflowId = "workflow_saved_001";
const proposalId = "proposal_saved_001";
const org = { id: orgId, label: "Acme Production", status: "connected", connectionVersion: 1 };
const empty: NotificationsInput = {
  orgs: [org],
  cli: { state: "ready", selected: "/usr/local/bin/sf" },
  extensions: [],
  workflows: [],
  activity: [],
  workspaceEnabled: true,
  reviewedEnabled: true,
};

function workflow(
  status: HeadfulResult<"listWorkflows">["workflows"][number]["status"],
  revision = 1,
): HeadfulResult<"listWorkflows">["workflows"][number] {
  return {
    id: workflowId,
    orgId,
    originatingGrantId: null,
    intent: "create-user",
    status,
    revision,
    digest: null,
    recordId: "005000000000001AAA",
    setup: {
      org: {
        id: orgId,
        label: org.label,
        salesforceOrgId: "00D000000000001AAA",
        instanceOrigin: "https://acme.example.test",
        status: "connected",
        createdAt: 1,
        isSandbox: false,
        organizationName: "Acme",
      },
      isSandbox: false,
      fields: [],
      profiles: [],
      licenses: [],
      defaults: {},
      unsupportedRequiredFields: [],
      bounded: true,
    },
    draft: {},
    operationHistory: [],
    createdAt: 1,
    updatedAt: 10,
  };
}

function event(
  id: number,
  kind: string,
  createdAt = id,
): HeadfulResult<"activity.list">["activity"][number] {
  return { id, kind, org_id: orgId, target_id: proposalId, created_at: createdAt };
}

function extension(
  values: Partial<Omit<HeadfulExtensionDescriptor, "manifest">> = {},
): HeadfulExtensionDescriptor {
  return headfulExtensionDescriptorSchema.parse({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      id: "connect",
      name: "Headful Connect",
      description: "Optional companion connection.",
      version: "1.0.0",
      packageName: "@headfulcloud/connect",
      license: "Proprietary",
      source: "bundled",
    },
    enabled: true,
    status: "active",
    compatible: true,
    ...values,
  });
}

describe("command search", () => {
  it("matches every token across fields and ranks title matches before description matches", () => {
    const entries: SearchEntry[] = [
      {
        id: "description",
        title: "Salesforce workspace",
        description: "Inspect permission sets",
        group: "Acme",
        destination: { kind: "page", page: "workspace" },
      },
      {
        id: "title",
        title: "Permission sets",
        description: "Inspect access",
        group: "Acme",
        destination: { kind: "workspace", location: { view: "permission-sets", orgId } },
      },
      {
        id: "other-org",
        title: "Permission sets",
        description: "Inspect access",
        group: "Sandbox",
        destination: { kind: "page", page: "workspace" },
      },
    ];
    expect(filterSearchEntries(entries, "  ACME   permission ").map((value) => value.id)).toEqual([
      "title",
      "description",
    ]);
    expect(filterSearchEntries(entries, "acme permission nonexistent")).toEqual([]);
    expect(entries[0]?.id).toBe("description");
  });

  it("bounds both initial and filtered results while retaining stable order", () => {
    const entries: SearchEntry[] = Array.from({ length: 40 }, (_, index) => ({
      id: String(index),
      title: "Org connection",
      description: "Salesforce",
      group: "Orgs",
      destination: { kind: "org", orgId: `org_${index}` },
    }));
    expect(filterSearchEntries(entries, "")).toEqual(entries.slice(0, 30));
    expect(filterSearchEntries(entries, "salesforce")).toEqual(entries.slice(0, 30));
  });
});

describe("notification projections", () => {
  it("supersedes preparation with the latest permission outcome, including same-time events", () => {
    const notifications = buildNotifications({
      ...empty,
      activity: [
        event(1, "permission_change_prepared", 30),
        event(3, "permission_change_completed", 30),
        event(2, "permission_change_execution_unknown", 30),
        event(4, "user_access_verified", 31),
      ],
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      id: "activity:3",
      level: "success",
      destination: {
        kind: "workspace",
        location: { view: "review", orgId, proposalId },
      },
    });
    expect(notifications[0]?.description).toContain("recent update");
    expect(
      buildNotifications({
        ...empty,
        activity: [event(1, "permission_change_prepared"), event(2, "permission_change_rejected")],
      }),
    ).toEqual([]);
  });

  it("treats preparation activity as a historical update rather than a current pending claim", () => {
    const [notification] = buildNotifications({
      ...empty,
      activity: [event(1, "permission_change_prepared")],
    });
    expect(notification?.title).toBe("Permission review recently prepared");
    expect(notification?.description).toContain("check its current status and expiry");
    expect(notification?.description).not.toContain("awaiting approval");
  });

  it("keeps workflow destinations bound to the saved org and record", () => {
    const [notification] = buildNotifications({
      ...empty,
      orgs: [{ ...org, id: "new_default_org_01", label: "New default" }, org],
      workflows: [workflow("access_prepared", 2)],
      activity: [{ ...event(1, "user_draft_prepared"), target_id: workflowId }],
    });
    expect(notification).toMatchObject({
      id: `workflow:${workflowId}:2:access_prepared`,
      destination: {
        kind: "workspace",
        location: {
          view: "user",
          orgId,
          workflowId,
          recordId: "005000000000001AAA",
        },
      },
    });
    const [updated] = buildNotifications({ ...empty, workflows: [workflow("completed", 3)] });
    expect(updated?.id).not.toBe(notification?.id);
    expect(updated?.level).toBe("success");
  });

  it("hides reviewed work when either required feature is disabled and omits in-progress drafts", () => {
    for (const features of [
      { workspaceEnabled: false, reviewedEnabled: true },
      { workspaceEnabled: true, reviewedEnabled: false },
      { workspaceEnabled: false, reviewedEnabled: false },
    ]) {
      expect(
        buildNotifications({
          ...empty,
          ...features,
          workflows: [workflow("prepared")],
          activity: [event(1, "permission_change_prepared")],
        }),
      ).toEqual([]);
    }
    expect(
      buildNotifications({
        ...empty,
        workflows: [workflow("draft"), workflow("creating"), workflow("access_applying")],
      }),
    ).toEqual([]);
  });

  it("falls back to Activity for retained work whose org has been removed", () => {
    const notifications = buildNotifications({
      ...empty,
      orgs: [],
      workflows: [workflow("execution_unknown")],
      activity: [event(1, "permission_change_failed")],
    });
    expect(notifications).toHaveLength(2);
    for (const notification of notifications) {
      expect(notification.destination).toEqual({ kind: "page", page: "activity" });
      expect(notification.level).toBe("warning");
    }
  });

  it("suppresses disabled extensions and exposes controlled status text without raw errors", () => {
    const error = { code: "activation_failed", message: "private secret error details" };
    expect(
      buildNotifications({
        ...empty,
        extensions: [extension({ enabled: false, status: "error", error })],
      }),
    ).toEqual([]);
    const notifications = buildNotifications({
      ...empty,
      extensions: [extension({ status: "error", error })],
    });
    expect(notifications).toHaveLength(1);
    expect(JSON.stringify(notifications)).not.toContain(error.message);
    expect(notifications[0]?.destination).toEqual({ kind: "extension", extensionId: "connect" });
    expect(
      buildNotifications({
        ...empty,
        extensions: [
          extension({
            runtimeStatuses: [{ id: "relay", label: "Relay", state: "offline", targetOrgIds: [] }],
          }),
        ],
      })[0],
    ).toMatchObject({ id: "extension:connect:relay:offline", level: "warning" });
  });

  it("surfaces CLI and identity recovery and bounds the inbox", () => {
    const notifications = buildNotifications({
      ...empty,
      cli: { state: "unsupported", selected: "/usr/local/bin/sf" },
      orgs: Array.from({ length: 100 }, (_, index) => ({
        ...org,
        id: `org_${index}`,
        status: index === 0 ? "identity-changed" : "reconnect-required",
      })),
    });
    expect(notifications).toHaveLength(100);
    expect(notifications[0]?.destination).toEqual({ kind: "page", page: "settings" });
    expect(notifications[1]?.description).toContain("identity changed");
    expect(notifications[1]?.destination).toEqual({ kind: "page", page: "orgs" });
  });
});
