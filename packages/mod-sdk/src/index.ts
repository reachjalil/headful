import { ModError, serializable, type Value } from "./schema.ts";
export { ModError, serializable, validateSchema, validateValue } from "./schema.ts";
export type { Value, ValueSchema } from "./schema.ts";
export interface ModChannel {
  call(method: string, input: Value): Promise<Value>;
  listen(handler: (method: string, input: Value) => Promise<Value>): () => void;
}
export interface ModSdk {
  background(handler: (signal: AbortSignal) => Promise<void>): void;
  command(id: string, handler: (input: Value, signal: AbortSignal) => Promise<Value>): void;
  api(id: string, handler: (input: Value, signal: AbortSignal) => Promise<Value>): void;
  event(type: string, listener: (event: Value, signal: AbortSignal) => Promise<void>): void;
  view(id: string, handler: (input: Value, signal: AbortSignal) => Promise<Value>): void;
  host(capability: string, operation: string, input: Value): Promise<Value>;
  callApi(id: string, input: Value): Promise<Value>;
  settings: { get(): Promise<Value>; set(values: Value): Promise<Value> };
  storage: { get(key: string): Promise<Value>; set(key: string, value: Value): Promise<Value> };
  cleanup(handler: () => void | Promise<void>): void;
  readonly signal: AbortSignal;
  dispose(): Promise<void>;
}
/** The channel is supplied by the host. The mod cannot choose its identity or authority. */
export function createModSdk(channel: ModChannel): ModSdk {
  const controller = new AbortController(),
    handlers = new Map<string, (value: Value, signal: AbortSignal) => Promise<Value>>(),
    cleanup: (() => void | Promise<void>)[] = [];
  const register = (
    kind: string,
    id: string,
    handler: (value: Value, signal: AbortSignal) => Promise<Value>,
  ) => {
    const key = kind + ":" + id;
    if (handlers.has(key)) throw new ModError("handler_conflict", "Handler already registered.");
    handlers.set(key, handler);
  };
  const stop = channel.listen(async (method, input) => {
    if (method === "lifecycle:dispose") {
      controller.abort();
      handlers.clear();
      for (const h of cleanup.splice(0).reverse()) await h();
      return null;
    }
    if (controller.signal.aborted) throw new ModError("context_stopped", "Mod stopped.");
    const handler = handlers.get(method);
    if (!handler) throw new ModError("handler_missing", "No handler registered.");
    return serializable(await handler(input, controller.signal));
  });
  const call = (method: string, input: Value) => {
    if (controller.signal.aborted)
      return Promise.reject(new ModError("context_stopped", "Mod stopped."));
    return channel.call(method, serializable(input));
  };
  return {
    background: (h) =>
      register("background", "", async (_v, s) => {
        await h(s);
        return null;
      }),
    command: (id, h) => register("command", id, h),
    api: (id, h) => register("api", id, h),
    view: (id, h) => register("view", id, h),
    event: (id, h) =>
      register("event", id, async (v, s) => {
        await h(v, s);
        return null;
      }),
    host: (capability, operation, input) => call("host", { capability, operation, input }),
    callApi: (id, input) => call("api", { id, input }),
    settings: {
      get: () => call("settings.get", {}),
      set: (values) => call("settings.set", values),
    },
    storage: {
      get: (key) => call("storage.get", { key }),
      set: (key, value) => call("storage.set", { key, value }),
    },
    cleanup: (h) => cleanup.push(h),
    signal: controller.signal,
    async dispose() {
      controller.abort();
      stop();
      handlers.clear();
      for (const h of cleanup.splice(0).reverse()) await h();
    },
  };
}
