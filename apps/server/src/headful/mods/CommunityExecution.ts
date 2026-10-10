// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
import * as NodeCrypto from "node:crypto";
import { ModError, serializable, type Value } from "../../../../../packages/mod-sdk/src/schema.ts";
import type {
  HeadfulModDefinition,
  HeadfulModContext,
  HeadfulModManifest,
} from "../../../../../packages/contracts/src/headful-mods.ts";
export type ExecutionJob = {
  context: string;
  revision: string;
  id: string;
  modId: string;
  directory: string;
  entry: string;
  method: string;
  input: Value;
};
type Context = {
  id: string;
  manifest: HeadfulModManifest;
  revision: string;
  directory: string;
  port: HeadfulModContext;
  jobs: ExecutionJob[];
  pending: Map<
    string,
    {
      resolve: (v: Value) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
};
/** Only authenticated Electron main can drain/reply. Community messages carry an opaque host-owned context. */
export class CommunityExecution {
  private contexts = new Map<string, Context>();
  private jobListeners = new Set<() => void>();
  waitForJob(): Promise<void> {
    if ([...this.contexts.values()].some((c) => c.jobs.length)) return Promise.resolve();
    return new Promise((resolve) => this.jobListeners.add(resolve));
  }
  private broker: (
    context: HeadfulModContext,
    manifest: HeadfulModManifest,
    method: string,
    input: Value,
  ) => Promise<Value>;
  constructor(
    broker: (
      context: HeadfulModContext,
      manifest: HeadfulModManifest,
      method: string,
      input: Value,
    ) => Promise<Value>,
  ) {
    this.broker = broker;
  }
  modForContext(context: string) {
    return this.contexts.get(context)?.manifest.id;
  }
  pull() {
    return {
      contexts: [...this.contexts.values()].map((c) => c.id),
      jobs: [...this.contexts.values()].flatMap((c) => c.jobs.splice(0, 16)),
    };
  }
  reply(context: string, id: string, result: unknown, error?: string) {
    const c = this.contexts.get(context),
      p = c?.pending.get(id);
    if (!c || !p || c.port.signal.aborted)
      throw new ModError("context_stopped", "Execution context is no longer valid.");
    clearTimeout(p.timer);
    c.pending.delete(id);
    error
      ? p.reject(new ModError("mod_failed", error.slice(0, 300)))
      : p.resolve(serializable(result));
    return { accepted: true };
  }
  async call(context: string, method: string, input: unknown) {
    const c = this.contexts.get(context);
    if (!c) throw new ModError("context_stopped", "Context not found.");
    c.port.requireActive();
    const result = await this.broker(c.port, c.manifest, method, serializable(input));
    c.port.requireActive();
    return serializable(result);
  }
  definition(
    manifest: HeadfulModManifest,
    revision: string,
    directory: string,
  ): HeadfulModDefinition {
    const thisExecution = this;
    return {
      manifest,
      artifactRevision: revision,
      async activate(port) {
        const id = NodeCrypto.randomUUID(),
          c: Context = { id, manifest, revision, directory, port, jobs: [], pending: new Map() };
        const close = () => {
          thisExecution.contexts.delete(id);
          for (const p of c.pending.values()) {
            clearTimeout(p.timer);
            p.reject(new ModError("context_stopped", "Mod execution stopped."));
          }
          c.pending.clear();
          c.jobs = [];
        };
        port.signal.addEventListener("abort", close, { once: true });
        thisExecution.contexts.set(id, c);
        const send = (method: string, input: unknown) =>
          new Promise<Value>((resolve, reject) => {
            port.requireActive();
            if (thisExecution.contexts.get(id) !== c)
              return reject(
                new ModError("context_stopped", "Execution context is no longer valid."),
              );
            const values = serializable(input);
            if (c.pending.size >= 32)
              return reject(new ModError("queue_limit", "Mod queue is full."));
            const request = NodeCrypto.randomUUID(),
              timer = setTimeout(() => {
                c.pending.delete(request);
                reject(new ModError("execution_timeout", "Mod exceeded its 10 second deadline."));
                close();
              }, 10000);
            c.pending.set(request, { resolve, reject, timer });
            c.jobs.push({
              context: id,
              revision,
              id: request,
              modId: manifest.id,
              directory,
              entry: manifest.entryPoints.renderer!,
              method,
              input: values,
            });
            for (const listener of thisExecution.jobListeners) listener();
            thisExecution.jobListeners.clear();
          });
        const unsubscribe = manifest.contributions.events.length
          ? port.events.subscribe((event) =>
              send("event:" + event.type, {
                schemaVersion: 1,
                source: "headful.host",
                ...event,
              }).then(() => undefined),
            )
          : () => {};
        return {
          startBackground: async () => {
            await send("background:", {});
          },
          dispose() {
            unsubscribe();
            close();
          },
          dispatchCommand: async (command, input) =>
            (await send("command:" + command, input)) as never,
          renderSurface: async (surface) => (await send("view:" + surface, {})) as never,
          dispatchApi: async (api, input) => send("api:" + api, input),
        };
      },
    };
  }
}
