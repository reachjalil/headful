import { assert, it } from "@effect/vitest";
import {
  type ModelSelection,
  type OrchestrationV2AppThread,
  ProjectId,
  ProviderInstanceId,
  type RuntimeMode,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as RuntimePolicy from "./RuntimePolicy.ts";
import { installAgentBoundaryResolver } from "../headful/AgentBoundary.ts";
import type { HeadfulAgentBoundary } from "../../../../packages/contracts/src/headful-agent.ts";

const projectId = ProjectId.make("project:runtime-policy");
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-5.5",
} satisfies ModelSelection;

function makeThread(input: {
  readonly now: DateTime.Utc;
  readonly worktreePath: string | null;
  readonly runtimeMode?: RuntimeMode;
}): OrchestrationV2AppThread {
  const threadId = ThreadId.make("thread:runtime-policy");
  return {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId,
    title: "Runtime policy",
    providerInstanceId,
    modelSelection,
    runtimeMode: input.runtimeMode ?? "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: input.worktreePath,
    activeProviderThreadId: null,
    lineage: {
      parentThreadId: null,
      relationshipToParent: null,
      rootThreadId: threadId,
    },
    forkedFrom: null,
    createdAt: input.now,
    updatedAt: input.now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

// Grok's instance offers no Auto-accept edits; the Codex instance advertises no
// restriction.
const grokInstanceId = ProviderInstanceId.make("grok");
const supportedRuntimeModesByInstance = new Map<ProviderInstanceId, ReadonlyArray<RuntimeMode>>([
  [grokInstanceId, ["approval-required", "auto", "full-access"]],
]);
const providerInstanceFor = (instanceId: ProviderInstanceId) =>
  ({
    driverKind: instanceId === grokInstanceId ? "grok" : "codex",
    snapshot: {
      getSnapshot: Effect.succeed({
        supportedRuntimeModes: supportedRuntimeModesByInstance.get(instanceId),
      } as ServerProvider),
    },
  }) as ProviderInstance;

const TestLayer = RuntimePolicy.layerFromProjectStore.pipe(
  Layer.provide(
    Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
      getInstance: (instanceId) => Effect.succeed(providerInstanceFor(instanceId)),
      listInstances: Effect.succeed([]),
      listUnavailable: Effect.succeed([]),
      streamChanges: Stream.empty,
      subscribeChanges: Effect.never,
    }),
  ),
  Layer.provide(
    Layer.mock(ProjectStore.ProjectStoreV2)({
      get: () =>
        Effect.succeed(
          Option.some({
            projectId,
            title: "Project",
            workspaceRoot: "/project-root",
            defaultModelSelection: null,
            defaultThreadEnvMode: null,
            autoPull: false,
            faviconPath: null,
            projectIcon: null,
            scripts: [],
            createdAt: "2026-06-21T00:00:00.000Z",
            updatedAt: "2026-06-21T00:00:00.000Z",
            deletedAt: null,
          }),
        ),
    }),
  ),
);

it.layer(TestLayer)("RuntimePolicyV2", (it) => {
  it.effect("fails closed for a reserved native thread without its native authority", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2,
        now = yield* DateTime.now;
      const thread = {
        ...makeThread({ now, worktreePath: null }),
        id: ThreadId.make("headful-agent-synthetic123456789"),
      };
      const result = yield* Effect.result(policy.resolve({ thread, modelSelection }));
      assert.equal(result._tag, "Failure");
    }),
  );
  it.effect(
    "pins native runner permissions and refuses project/provider retargeting or a global override",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const now = yield* DateTime.now;
          const thread = {
            ...makeThread({ now, worktreePath: "/caller-worktree" }),
            id: ThreadId.make("headful-agent-synthetic123456789"),
          };
          const boundary: HeadfulAgentBoundary = {
            ownerModId: "headful.connect-desktop",
            threadId: thread.id,
            projectId,
            providerInstanceId,
            model: modelSelection.model,
            expiresAt: 1_000_000,
            workspace: "/native-isolated-workspace",
            mcp: {
              endpoint: "http://127.0.0.1:12345/runs/synthetic",
              authorization: "Bearer synthetic-native-broker",
              tools: ["list_orgs"],
            },
            revokedAt: null,
          };
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              installAgentBoundaryResolver(
                () => boundary,
                () => 1,
              ),
            ),
            (release) => Effect.sync(release),
          );
          const policy = yield* RuntimePolicy.RuntimePolicyV2;
          const resolved = yield* policy.resolve({ thread, modelSelection });
          assert.equal(resolved.cwd, boundary.workspace);
          assert.equal(resolved.approvalPolicy, "never");
          const profileId = "headful_admin_" + boundary.threadId.replaceAll("-", "_");
          assert.equal(resolved.nativeAgent?.config.default_permissions, profileId);
          assert.deepEqual(resolved.nativeAgent?.config.permissions, {
            [profileId]: {
              description: "Headful bounded native Admin work",
              filesystem: { ":minimal": "read", [boundary.workspace]: "read" },
              network: { enabled: false },
            },
          });
          assert.equal(resolved.nativeAgent?.config.project_doc_max_bytes, 0);
          assert.equal(resolved.nativeAgent?.config["features.shell_tool"], false);
          const overridden = yield* Effect.gen(function* () {
            return yield* (yield* RuntimePolicy.RuntimePolicyV2).resolve({
              thread,
              modelSelection,
            });
          }).pipe(
            Effect.provide(
              RuntimePolicy.layerWithOverride({
                cwd: "/outside",
                sandboxPolicy: { type: "dangerFullAccess" },
              }),
            ),
          );
          assert.deepEqual(overridden, resolved);
          const retargeted = yield* Effect.result(
            policy.resolve({
              thread: { ...thread, projectId: ProjectId.make("other-project") },
              modelSelection,
            }),
          );
          assert.equal(retargeted._tag, "Failure");
          boundary.revokedAt = 1;
          assert.equal(
            (yield* Effect.result(policy.resolve({ thread, modelSelection })))._tag,
            "Failure",
          );
        }),
      ),
  );
  it.effect("uses the project root for local-checkout threads", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const resolved = yield* policy.resolve({
        thread: makeThread({ now, worktreePath: null }),
        modelSelection,
      });
      assert.equal(resolved.cwd, "/project-root");
    }),
  );

  it.effect("prefers a provisioned worktree over the project root", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const resolved = yield* policy.resolve({
        thread: makeThread({ now, worktreePath: "/project-worktree" }),
        modelSelection,
      });
      assert.equal(resolved.cwd, "/project-worktree");
    }),
  );

  it.effect("runs a mode the provider does not offer in Supervised", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const modeFor = (instanceId: ProviderInstanceId, runtimeMode: RuntimeMode) =>
        policy
          .resolve({
            thread: makeThread({ now, worktreePath: null, runtimeMode }),
            modelSelection: { instanceId, model: "test-model" },
          })
          .pipe(Effect.map((resolved) => resolved.runtimeMode));

      assert.equal(yield* modeFor(grokInstanceId, "auto-accept-edits"), "approval-required");
      assert.equal(yield* modeFor(grokInstanceId, "auto"), "auto");
      assert.equal(yield* modeFor(grokInstanceId, "full-access"), "full-access");
      // A provider that advertises no restriction runs every mode as stored.
      assert.equal(yield* modeFor(providerInstanceId, "auto-accept-edits"), "auto-accept-edits");
    }),
  );
});
