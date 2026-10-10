import { assert, it } from "@effect/vitest";
import {
  nativeAgentConfig,
  assertNativeAgentSession,
  assertNativeAgentInventory,
} from "./NativeAgentPolicy.ts";
const config = nativeAgentConfig({
  threadId: "headful-agent-synthetic123456789",
  ownerModId: "headful.connect-desktop",
  projectId: "synthetic-project",
  providerInstanceId: "synthetic-provider",
  model: "synthetic-model",
  expiresAt: 1000,
  revokedAt: null,
  workspace: "/native/workspace",
  mcp: {
    endpoint: "http://127.0.0.1:12345/run/synthetic",
    authorization: "Bearer synthetic-only",
    tools: ["list_orgs"],
  },
});
const params = { cwd: "/native/workspace", config };
const response = {
  cwd: params.cwd,
  approvalPolicy: "never",
  sandbox: { type: "readOnly", networkAccess: false },
  activePermissionProfile: { id: config.default_permissions },
};
it("rejects effective provider session widening, missing provenance and inherited profiles", () => {
  assertNativeAgentSession(response, params);
  for (const changed of [
    { cwd: "/outside" },
    { approvalPolicy: "on-request" },
    { sandbox: { type: "dangerFullAccess" } },
    { sandbox: { type: "readOnly", networkAccess: true } },
    { activePermissionProfile: null },
    { activePermissionProfile: { id: config.default_permissions, extends: ":danger-full-access" } },
  ])
    assert.throws(() => assertNativeAgentSession({ ...response, ...changed }, params));
});
it("requires a live exact broker and complete tool catalog before starting a turn", () => {
  const server = {
    name: "headful-admin",
    runtimeStatus: "connected",
    httpOrigin: "http://127.0.0.1:12345",
    tools: { list_orgs: {} },
    resources: [],
    resourceTemplates: [],
  };
  assertNativeAgentInventory({ data: [server], nextCursor: null }, ["list_orgs"], config);
  for (const changed of [
    { runtimeStatus: "failed" },
    { tools: {} },
    { tools: { list_orgs: {}, write_anything: {} } },
    { httpOrigin: "http://127.0.0.1:9999" },
    { resources: [{ uri: "credential" }] },
  ])
    assert.throws(() =>
      assertNativeAgentInventory({ data: [{ ...server, ...changed }] }, ["list_orgs"], config),
    );
  assert.throws(() =>
    assertNativeAgentInventory({ data: [server, { name: "unrelated" }] }, ["list_orgs"], config),
  );
});
