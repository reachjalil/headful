// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";
import { installExperienceControl } from "./experience-control";

afterEach(() => vi.unstubAllGlobals());
it("waits for the visible lazy surface, ignores hidden work and dispatches a click exactly once", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const root = document.createElement("main");
  root.dataset.experience = "admin-workspace";
  root.setAttribute("aria-busy", "false");
  root.innerHTML =
    '<button data-testid="admin-test-control">Open tool</button><div data-loading aria-busy="false"></div><aside hidden><div aria-busy="true"></div></aside>';
  document.body.append(root);
  const busy = root.querySelector("[data-loading]")!;
  const click = vi.fn(() => busy.setAttribute("aria-busy", "true"));
  root.querySelector("button")!.addEventListener("click", click);
  const uninstall = installExperienceControl(
    () => ({
      flow: "admin-workspace",
      fixture: "ready",
      step: "schema",
      empty: false,
      controls: 1,
      alerts: 0,
    }),
    async () => {},
    async () => {
      throw Error("No native grant in this test");
    },
  );
  try {
    let done = false;
    const pending = window.__headfulExperienceControl!("click", {
      testId: "admin-test-control",
    }).then(() => {
      done = true;
    });
    await Promise.resolve();
    frames.shift()!(performance.now());
    await Promise.resolve();
    expect(done).toBe(false);
    expect(click).toHaveBeenCalledTimes(1);
    busy.setAttribute("aria-busy", "false");
    frames.shift()!(performance.now());
    await pending;
    expect(done).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
  } finally {
    uninstall();
    root.remove();
  }
});
