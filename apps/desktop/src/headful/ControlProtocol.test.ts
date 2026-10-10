// @effect-diagnostics globalTimers:off
import { describe, it, expect, vi } from "vite-plus/test";
import { compileRecipe, runRecipe } from "./ControlProtocol.ts";
describe("bounded experience recipes", () => {
  it("validates every step and grant before any effect", async () => {
    const execute = vi.fn();
    await expect(
      runRecipe(
        'await app.reset(); await app.exec({"command":"rm"});',
        ["fixtures"],
        true,
        execute,
      ),
    ).rejects.toThrow("Unknown");
    expect(execute).not.toHaveBeenCalled();
    await expect(
      runRecipe("await app.reset(); await app.screenshot();", ["fixtures"], true, execute),
    ).rejects.toThrow("Scope required");
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([
    "while(true) {}",
    'await fetch("https://example.test");',
    "await app.state(process.env);",
    'await app["state"]();',
    "const x = await app.state();",
    'await app.mock({fixture:"ready"});',
  ])("rejects unbounded or executable input: %s", (code) => {
    expect(() => compileRecipe(code)).toThrow();
  });
  it("keeps packaged builds diagnostic-only", async () => {
    const execute = vi.fn(async () => ({ ready: true }));
    await expect(runRecipe("await app.state();", ["inspect"], false, execute)).rejects.toThrow(
      "development-only",
    );
    expect(execute).not.toHaveBeenCalled();
    expect(
      (await runRecipe("await app.diagnostics();", ["diagnostics"], false, execute)).status,
    ).toBe("passed");
  });
  it("accepts literal namespaced contribution ids while rejecting selector injection and oversized ids", () => {
    expect(
      compileRecipe('await app.click({"testId":"editor-action-org.example.hello/hello"});')[0]
        ?.input,
    ).toEqual({ testId: "editor-action-org.example.hello/hello" });
    for (const testId of [
      'editor-tool-foo"],button,[data-x="',
      "editor-tool-[name]",
      "editor-tool-#root",
      "a".repeat(161),
    ])
      expect(() => compileRecipe(`await app.click(${JSON.stringify({ testId })});`)).toThrow();
  });
  it("stops at the first error and preserves completed results without retry", async () => {
    const execute = vi.fn(async (method) => {
      if (method === "click") throw new Error("Control missing");
      return { empty: true };
    });
    const outcome = await runRecipe(
      'await app.state(); await app.click({"testId":"continue"}); await app.screenshot();',
      ["inspect", "interact", "capture"],
      true,
      execute,
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.results).toHaveLength(2);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(outcome.results[0]?.result).toEqual({ empty: true });
  });
  it("bounds capture time and evidence size before executing", async () => {
    const execute = vi.fn();
    await expect(
      runRecipe(
        'await app.record({"frames":12,"intervalMs":1000}); await app.screenshot();',
        ["capture"],
        true,
        execute,
      ),
    ).rejects.toThrow("12 capture frames");
    expect(execute).not.toHaveBeenCalled();
  });
});
