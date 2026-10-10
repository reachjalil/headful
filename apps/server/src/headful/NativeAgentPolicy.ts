import type { HeadfulAgentBoundary } from "../../../../packages/contracts/src/headful-agent.ts";

/** A unique profile avoids inheriting a user's unrelated named profile table.
 * All provider operations still pass through the normal T3 adapter. */
export function nativeAgentConfig(boundary: HeadfulAgentBoundary) {
  const profile = "headful_admin_" + boundary.threadId.replaceAll("-", "_");
  return {
    default_permissions: profile,
    permissions: {
      [profile]: {
        description: "Headful bounded native Admin work",
        filesystem: { ":minimal": "read", [boundary.workspace]: "read" },
        network: { enabled: false },
      },
    },
    "features.shell_tool": false,
    "features.shell_snapshot": false,
    "features.multi_agent": false,
    "features.apps": false,
    "features.hooks": false,
    "features.remote_plugin": false,
    "features.goals": false,
    "features.memories": false,
    "features.skill_mcp_dependency_install": false,
    "features.code_mode.enabled": false,
    "browser_use.enabled": false,
    "computer_use.enabled": false,
    web_search: "disabled",
    project_doc_max_bytes: 0,
    mcp_servers: {
      "headful-admin": {
        url: boundary.mcp.endpoint,
        http_headers: { Authorization: boundary.mcp.authorization },
        enabled_tools: boundary.mcp.tools,
        required: true,
      },
    },
  };
}

const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function assertNativeAgentSession(
  value: unknown,
  expected: { cwd?: string | null; config: Readonly<Record<string, unknown>> },
) {
  const response = object(value),
    sandbox = object(response.sandbox),
    profile = object(response.activePermissionProfile);
  if (
    !expected.cwd ||
    response.cwd !== expected.cwd ||
    response.approvalPolicy !== "never" ||
    sandbox.type !== "readOnly" ||
    sandbox.networkAccess !== false ||
    profile.id !== expected.config.default_permissions ||
    profile.extends != null
  )
    throw new Error("Codex did not establish the exact native Admin permission boundary.");
}

export function assertNativeAgentInventory(
  value: unknown,
  toolNames: readonly string[],
  config: Readonly<Record<string, unknown>>,
) {
  const inventory = object(value),
    data = inventory.data;
  if (!Array.isArray(data) || data.length !== 1 || inventory.nextCursor)
    throw new Error("Native Admin MCP inventory is incomplete or includes another server.");
  const server = object(data[0]),
    names = Object.keys(object(server.tools));
  const expected = object(object(config.mcp_servers)["headful-admin"]);
  if (
    server.name !== "headful-admin" ||
    server.runtimeStatus !== "connected" ||
    server.toolsError ||
    typeof expected.url !== "string" ||
    (server.httpOrigin != null && server.httpOrigin !== new URL(expected.url).origin) ||
    names.length !== toolNames.length ||
    names.some((name) => !toolNames.includes(name)) ||
    !Array.isArray(server.resources) ||
    server.resources.length ||
    !Array.isArray(server.resourceTemplates) ||
    server.resourceTemplates.length
  )
    throw new Error("Native Admin MCP inventory does not match its approved connected boundary.");
}
