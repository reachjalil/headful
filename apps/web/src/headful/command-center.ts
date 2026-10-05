import type { HeadfulResult } from "@t3tools/contracts/headful";
import type { HeadfulExtensionDescriptor } from "@t3tools/contracts/headful-extensions";
import type { WorkspaceLocation } from "./workspace-view";

export type CommandDestination =
  | {
      kind: "page";
      page: "orgs" | "workspace" | "integrations" | "activity" | "extensions" | "settings";
    }
  | { kind: "org"; orgId: string }
  | { kind: "workspace"; location: WorkspaceLocation }
  | { kind: "utility"; componentId: string }
  | { kind: "extension"; extensionId: string };

export interface SearchEntry {
  id: string;
  title: string;
  description: string;
  group: string;
  destination: CommandDestination;
}

export function filterSearchEntries(entries: readonly SearchEntry[], query: string): SearchEntry[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return entries.slice(0, 30);
  return entries
    .map((entry, index) => {
      const title = entry.title.toLowerCase();
      const searchable = `${title} ${entry.description} ${entry.group}`.toLowerCase();
      return {
        entry,
        index,
        matches: tokens.every((token) => searchable.includes(token)),
        titleMatches: tokens.filter((token) => title.includes(token)).length,
      };
    })
    .filter((result) => result.matches)
    .sort((a, b) => b.titleMatches - a.titleMatches || a.index - b.index)
    .slice(0, 30)
    .map((result) => result.entry);
}

export interface NotificationEntry {
  id: string;
  title: string;
  description: string;
  level: "info" | "warning" | "success";
  timestamp?: number;
  destination: CommandDestination;
}

export interface NotificationsInput {
  orgs: readonly Pick<
    HeadfulResult<"status">["orgs"][number],
    "id" | "label" | "status" | "connectionVersion"
  >[];
  cli: Pick<HeadfulResult<"cli.detect">, "state" | "selected"> | null;
  extensions: readonly HeadfulExtensionDescriptor[];
  workflows: readonly HeadfulResult<"listWorkflows">["workflows"][number][];
  activity: readonly HeadfulResult<"activity.list">["activity"][number][];
  workspaceEnabled: boolean;
  reviewedEnabled: boolean;
}

const workflowMessages = {
  prepared: {
    title: "User creation ready to review",
    description: "Review the saved draft before approving a Salesforce change.",
    level: "info",
  },
  access_prepared: {
    title: "Access changes ready to review",
    description: "Review the saved permission changes before approving them.",
    level: "info",
  },
  access_pending: {
    title: "User access setup remains",
    description: "The user is created; continue the saved workflow to set up access.",
    level: "info",
  },
  execution_unknown: {
    title: "Salesforce outcome needs reconciliation",
    description:
      "The saved workflow has an uncertain outcome. Inspect it before any further change.",
    level: "warning",
  },
  failed: {
    title: "Reviewed workflow failed",
    description: "Inspect the saved workflow and its confirmed progress before continuing.",
    level: "warning",
  },
  partial: {
    title: "Access changes partially completed",
    description: "Confirmed progress is saved. Inspect the remaining access changes.",
    level: "warning",
  },
  completed: {
    title: "Reviewed workflow completed",
    description: "Open the saved workflow to inspect its confirmed result.",
    level: "success",
  },
} satisfies Record<string, Pick<NotificationEntry, "title" | "description" | "level">>;

const permissionMessages = {
  permission_change_prepared: {
    title: "Permission review recently prepared",
    description: "Open the retained proposal to check its current status and expiry.",
    level: "info",
  },
  permission_change_completed: {
    title: "Permission change confirmed",
    description: "A recent update recorded completion. Open the retained receipt and readback.",
    level: "success",
  },
  permission_change_failed: {
    title: "Permission change failure recorded",
    description:
      "A recent update recorded failure. Inspect the retained proposal before continuing.",
    level: "warning",
  },
  permission_change_execution_unknown: {
    title: "Permission change outcome uncertain",
    description:
      "A recent update recorded an uncertain outcome. Inspect it before any further change.",
    level: "warning",
  },
} satisfies Record<string, Pick<NotificationEntry, "title" | "description" | "level">>;

function hasKey<T extends object>(object: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function buildNotifications(input: NotificationsInput): NotificationEntry[] {
  const notifications: NotificationEntry[] = [];
  const orgs = new Map(input.orgs.map((org) => [org.id, org]));
  if (input.cli?.state === "missing" || input.cli?.state === "unsupported") {
    notifications.push({
      id: `cli:${input.cli.state}:${input.cli.selected || "none"}`,
      title:
        input.cli.state === "missing"
          ? "Salesforce CLI is missing"
          : "Salesforce CLI needs an update",
      description: "Open Settings to configure a supported Salesforce CLI installation.",
      level: "warning",
      destination: { kind: "page", page: "settings" },
    });
  }
  for (const org of input.orgs) {
    if (org.status !== "reconnect-required" && org.status !== "identity-changed") continue;
    notifications.push({
      id: `org:${org.id}:${org.connectionVersion}:${org.status}`,
      title: `${org.label} needs attention`,
      description:
        org.status === "identity-changed"
          ? "The connected Salesforce identity changed. Verify the org connection before continuing."
          : "Reconnect this org to restore Salesforce access.",
      level: "warning",
      destination: { kind: "page", page: "orgs" },
    });
  }
  for (const extension of input.extensions) {
    if (!extension.enabled) continue;
    const { id, name } = extension.manifest;
    if (["error", "blocked", "incompatible"].includes(extension.status)) {
      notifications.push({
        id: `extension:${id}:${extension.status}`,
        title: `${name} needs attention`,
        description:
          extension.status === "incompatible"
            ? "This extension is incompatible with the current runtime. Open Extensions to inspect it."
            : "This extension could not activate. Open Extensions to inspect its status.",
        level: "warning",
        destination: { kind: "extension", extensionId: id },
      });
    }
    if (extension.status !== "active") continue;
    for (const runtime of extension.runtimeStatuses) {
      if (runtime.state !== "error" && runtime.state !== "offline") continue;
      notifications.push({
        id: `extension:${id}:${runtime.id}:${runtime.state}`,
        title: `${name}: ${runtime.label}`,
        description:
          runtime.state === "offline"
            ? "This extension service is offline. Open Extensions to inspect its status."
            : "This extension service needs attention. Open Extensions to inspect its status.",
        level: "warning",
        destination: { kind: "extension", extensionId: id },
      });
    }
  }
  if (input.workspaceEnabled && input.reviewedEnabled) {
    for (const workflow of input.workflows) {
      if (!hasKey(workflowMessages, workflow.status)) continue;
      const message = workflowMessages[workflow.status];
      notifications.push({
        id: `workflow:${workflow.id}:${workflow.revision}:${workflow.status}`,
        ...message,
        description: `${workflow.setup.org.label} · ${message.description}`,
        timestamp: workflow.updatedAt,
        destination: orgs.has(workflow.orgId)
          ? {
              kind: "workspace",
              location: {
                view: workflow.recordId ? "user" : "create-user",
                orgId: workflow.orgId,
                workflowId: workflow.id,
                ...(workflow.recordId ? { recordId: workflow.recordId } : {}),
              },
            }
          : { kind: "page", page: "activity" },
      });
    }
    // Activity is a bounded history, not the proposal's current state. A later event
    // supersedes an earlier preparation even when that later event has no notification.
    const latest = new Map<string, HeadfulResult<"activity.list">["activity"][number]>();
    for (const event of [...input.activity].sort(
      (a, b) => b.created_at - a.created_at || b.id - a.id,
    )) {
      if (!event.kind.startsWith("permission_change_") || !event.target_id) continue;
      const key = `${event.org_id || ""}:${event.target_id}`;
      if (!latest.has(key)) latest.set(key, event);
    }
    for (const event of latest.values()) {
      if (!hasKey(permissionMessages, event.kind)) continue;
      const message = permissionMessages[event.kind];
      const org = event.org_id ? orgs.get(event.org_id) : undefined;
      notifications.push({
        id: `activity:${event.id}`,
        ...message,
        description: `${org?.label || "Recorded org"} · ${message.description}`,
        timestamp: event.created_at,
        destination:
          org && event.target_id
            ? {
                kind: "workspace",
                location: { view: "review", orgId: org.id, proposalId: event.target_id },
              }
            : { kind: "page", page: "activity" },
      });
    }
  }
  const levelOrder = { warning: 0, info: 1, success: 2 };
  return notifications
    .sort(
      (a, b) =>
        levelOrder[a.level] - levelOrder[b.level] || (b.timestamp || 0) - (a.timestamp || 0),
    )
    .slice(0, 100);
}
