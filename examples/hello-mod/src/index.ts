import { createModSdk, type ModChannel } from "../../../packages/mod-sdk/src/index.ts";
declare global {
  var activateHeadfulMod: (channel: ModChannel) => void;
}
globalThis.activateHeadfulMod = (channel) => {
  const sdk = createModSdk(channel);
  sdk.command("org.example.hello/hello", async () => {
    const count = Number((await sdk.storage.get("count")) ?? 0) + 1;
    await sdk.storage.set("count", count);
    return { message: "Hello from your sandboxed local mod.", values: { count } };
  });
  sdk.api("org.example.hello/greet", async (input) => "Hello, " + (input as { name: string }).name);
  sdk.event("default-org-changed", async () => {
    const count = Number((await sdk.storage.get("events")) ?? 0) + 1;
    await sdk.storage.set("events", count);
  });
  sdk.view("overview", async () => ({
    title: "Local counter",
    markdown: `Invocations: ${(await sdk.storage.get("count")) ?? 0}. Host events: ${(await sdk.storage.get("events")) ?? 0}.`,
  }));
  sdk.cleanup(() => {});
};
