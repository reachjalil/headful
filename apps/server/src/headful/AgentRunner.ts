import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Receipts from "../orchestration-v2/CommandReceiptStore.ts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
// @effect-diagnostics-next-line nodeBuiltinImport:off - Native authority uses descriptor no-follow checks and fsync.
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off - This Promise port shares native paths with RuntimeHost.
import * as NodePath from "node:path";
import { CommandId, ThreadId, MessageId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import type {
  HeadfulAgentBoundary,
  HeadfulAgentRunnerPort,
  HeadfulAgentRunnerFactory,
} from "../../../../packages/contracts/src/headful-agent.ts";
import * as ServerConfig from "../config.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderInstances from "../provider/Services/ProviderInstanceRegistry.ts";
import { installAgentBoundaryResolver, nativeAgentBoundary } from "./AgentBoundary.ts";

export class AgentRunnerError extends Schema.TaggedError<AgentRunnerError>()("AgentRunnerError", {
  cause: Schema.Defect(),
}) {
  override get message() {
    return "The native T3 agent service could not complete this operation. Reconcile its existing receipt.";
  }
}
export class AgentRunner extends Context.Service<
  AgentRunner,
  { readonly factory: HeadfulAgentRunnerFactory }
>()("t3/headful/AgentRunner") {}
const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const clock = yield* Clock.Clock;
  const run = Effect.runPromiseWith(yield* Effect.context<never>());
  const launch = yield* ThreadLaunch.ThreadLaunchService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const receipts = yield* Receipts.CommandReceiptStoreV2;
  const providers = yield* ProviderInstances.ProviderInstanceRegistry;
  const directory = NodePath.join(config.stateDir, "headful", "agent-boundaries");
  const fileFor = (threadId: string) => {
    if (!/^headful-agent-[A-Za-z0-9_-]{16,100}$/.test(threadId))
      throw new Error("Invalid native thread.");
    return NodePath.join(directory, threadId + ".json");
  };
  const ensureDirectory = () => {
    NodeFS.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const info = NodeFS.lstatSync(directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      info.mode & 0o077
    )
      throw new Error("Unsafe native authority directory.");
  };
  const read = (threadId: string): HeadfulAgentBoundary => {
    ensureDirectory();
    const file = fileFor(threadId),
      fd = NodeFS.openSync(file, NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW);
    try {
      const info = NodeFS.fstatSync(fd);
      if (
        !info.isFile() ||
        info.uid !== process.getuid?.() ||
        info.nlink !== 1 ||
        info.mode & 0o077 ||
        info.size > 16_000
      )
        throw new Error("Unsafe native authority.");
      const boundary = JSON.parse(NodeFS.readFileSync(fd, "utf8")) as HeadfulAgentBoundary;
      if (boundary.threadId !== threadId) throw new Error("Native authority mismatch.");
      return boundary;
    } finally {
      NodeFS.closeSync(fd);
    }
  };
  const save = (boundary: HeadfulAgentBoundary) => {
    ensureDirectory();
    const file = fileFor(boundary.threadId),
      temporary = file + ".tmp";
    const fd = NodeFS.openSync(temporary, "wx", 0o600);
    try {
      NodeFS.writeFileSync(fd, JSON.stringify(boundary));
      NodeFS.fsyncSync(fd);
    } finally {
      NodeFS.closeSync(fd);
    }
    try {
      NodeFS.renameSync(temporary, file);
      const dir = NodeFS.openSync(directory, NodeFS.constants.O_RDONLY);
      try {
        NodeFS.fsyncSync(dir);
      } finally {
        NodeFS.closeSync(dir);
      }
    } catch (error) {
      NodeFS.unlinkSync(temporary);
      throw error;
    }
  };
  const release = yield* Effect.try({
    try: () => installAgentBoundaryResolver(read, () => clock.currentTimeMillisUnsafe()),
    catch: (cause) => new AgentRunnerError({ cause }),
  });
  yield* Effect.addFinalizer(() => Effect.sync(release));
  const forMod = (ownerModId: string): HeadfulAgentRunnerPort => {
    if (!/^[a-z][a-z0-9.-]{2,100}$/.test(ownerModId))
      throw new Error("Invalid native mod identity.");
    const owned = (threadId: string) => {
      const boundary = read(threadId);
      if (boundary.ownerModId !== ownerModId)
        throw new Error("This native thread belongs to another mod.");
      return boundary;
    };
    const current = (threadId: string) => {
      const boundary = nativeAgentBoundary(threadId);
      if (!boundary || boundary.ownerModId !== ownerModId)
        throw new Error("Unknown native thread.");
      return boundary;
    };
    const port: HeadfulAgentRunnerPort = {
      options: async () => {
        const snapshot = await run(projects.snapshot);
        const instances = await run(providers.listInstances);
        return {
          projects: snapshot.projects.map((project) => ({ id: project.id, name: project.title })),
          providers: await Promise.all(
            instances
              .filter((instance) => instance.enabled)
              .map(async (instance) => {
                const snapshot = await run(instance.snapshot.getSnapshot);
                return {
                  instanceId: instance.instanceId,
                  driver: instance.driverKind,
                  models: snapshot.models.map((model) => model.slug),
                  boundedExecution: instance.driverKind === "codex",
                };
              }),
          ),
        };
      },
      launch: async (input) => {
        fileFor(input.threadId);
        const endpoint = new URL(input.mcp.endpoint);
        if (
          endpoint.protocol !== "http:" ||
          endpoint.hostname !== "127.0.0.1" ||
          endpoint.username ||
          endpoint.password ||
          !endpoint.port ||
          input.expiresAt <= clock.currentTimeMillisUnsafe() ||
          input.expiresAt > clock.currentTimeMillisUnsafe() + 3_600_000 ||
          input.instructions.length > 16000 ||
          input.mcp.tools.length > 50
        )
          throw new Error("Invalid native run boundary.");
        const instance = await run(
          providers.getInstance(ProviderInstanceId.make(input.providerInstanceId)),
        );
        if (!instance?.enabled || instance.driverKind !== "codex")
          throw new Error(
            "This T3 provider does not yet enforce Headful's bounded execution profile.",
          );
        const snapshot = await run(instance.snapshot.getSnapshot);
        if (!snapshot.models.some((model) => model.slug === input.model))
          throw new Error("Choose a model configured on this Mac.");
        const workspace = NodePath.join(directory, input.threadId, "workspace");
        NodeFS.mkdirSync(workspace, { recursive: true, mode: 0o700 });
        const canonicalWorkspace = NodeFS.realpathSync(workspace);
        const workspaceInfo = NodeFS.lstatSync(workspace);
        if (
          !workspaceInfo.isDirectory() ||
          workspaceInfo.isSymbolicLink() ||
          workspaceInfo.uid !== process.getuid?.() ||
          workspaceInfo.mode & 0o077
        )
          throw new Error("Unsafe native workspace.");
        const boundary: HeadfulAgentBoundary = {
          ownerModId,
          threadId: input.threadId,
          projectId: input.projectId,
          providerInstanceId: input.providerInstanceId,
          model: input.model,
          expiresAt: input.expiresAt,
          workspace: canonicalWorkspace,
          mcp: input.mcp,
          revokedAt: null,
        };
        try {
          const saved = read(input.threadId);
          if (JSON.stringify(saved) !== JSON.stringify(boundary))
            throw new Error("Native thread boundary changed.");
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
          )
            save(boundary);
          else throw error;
        }
        const result = await run(
          launch.launch({
            commandId: CommandId.make(input.commandId),
            threadId: ThreadId.make(input.threadId),
            projectId: ProjectId.make(input.projectId),
            title: input.title,
            generateTitle: false,
            modelSelection: {
              instanceId: ProviderInstanceId.make(input.providerInstanceId),
              model: input.model,
            },
            runtimeMode: "approval-required",
            interactionMode: "default",
            workspaceStrategy: { type: "existing_worktree", worktreePath: canonicalWorkspace },
            initialMessage: {
              messageId: MessageId.make(input.commandId + "-message"),
              text: input.instructions,
              attachments: [],
            },
            createdBy: "agent",
            creationSource: "mcp",
          }),
        );
        return { threadId: result.threadId, resumed: result.resumed };
      },
      read: async (threadId) => {
        const boundary = owned(threadId);
        const result = await run(
          threads.getProjectThreadRecords(
            { projectId: ProjectId.make(boundary.projectId), threadId: ThreadId.make(threadId) },
            ["runs", "messages"],
          ),
        );
        const latestRun = result.runs.at(-1);
        return {
          threadId,
          status: latestRun?.status ?? "preparing",
          nativeRunId: latestRun?.id ?? null,
          activity: result.messages
            .filter((message) => message.role === "user" || message.role === "assistant")
            .slice(-100)
            .map((message) => ({
              id: message.id,
              role: message.role,
              text: message.text.slice(0, 16000),
              streaming: message.streaming,
            })),
          observedAt: DateTime.formatIso(DateTime.makeUnsafe(clock.currentTimeMillisUnsafe())),
        };
      },
      message: async (input) => {
        const boundary = current(input.threadId);
        const result = await run(
          threads.sendToThread({
            projectId: ProjectId.make(boundary.projectId),
            threadId: ThreadId.make(input.threadId),
            commandId: CommandId.make(input.commandId),
            messageId: MessageId.make(input.commandId + "-message"),
            text: input.instructions,
            attachments: [],
            mode: "auto",
            createdBy: "agent",
            creationSource: "mcp",
          }),
        );
        return { delivery: result.delivery, nativeRunId: result.run.id };
      },
      interrupt: async (input) => {
        const boundary = owned(input.threadId);
        const result = await run(
          threads.interruptThread({
            projectId: ProjectId.make(boundary.projectId),
            threadId: ThreadId.make(input.threadId),
            commandId: CommandId.make(input.commandId),
            reason: "Headful native interruption requested",
          }),
        );
        return { outcome: result.type };
      },
      receipt: async (input) => {
        owned(input.threadId);
        const result = await run(receipts.getByCommandId(CommandId.make(input.commandId)));
        if (
          Option.isNone(result) ||
          !("threadId" in result.value) ||
          result.value.threadId !== input.threadId
        )
          return { status: "unavailable" };
        return { status: result.value.status, sequence: result.value.resultSequence };
      },
      revoke: async (threadId) => {
        const boundary = owned(threadId);
        boundary.revokedAt ??= clock.currentTimeMillisUnsafe();
        save(boundary);
      },
    };
    return port;
  };
  return AgentRunner.of({ factory: { forMod } });
});
export const layer = Layer.effect(AgentRunner, make).pipe(Layer.provide(Receipts.layer));
