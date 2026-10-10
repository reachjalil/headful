// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { HeadfulShell } from "./HeadfulShell";
import { createSetupFixture } from "./setup-fixtures";

it("mounts only the composed Salesforce setup despite old routes and chat shortcuts", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const dispatch = vi.fn(createSetupFixture("ready"));
  const onNavigate = vi.fn();
  window.headfulBridge = {
    dispatch: dispatch as NonNullable<Window["headfulBridge"]>["dispatch"],
    onNavigate,
  };
  history.replaceState(null, "", "/?headfulChat=1#workspace?view=create-user");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<HeadfulShell />));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(container.textContent).toContain("Welcome to Headful");
    expect(container.querySelector("header, iframe")).toBeNull();
    expect(dispatch.mock.calls.some(([operation]) => operation === "onboarding.complete")).toBe(
      false,
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    delete window.headfulBridge;
    history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  }
});
