// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { OrgShortcuts } from "../../../../../packages/headful-admin-utilities/src/web/OrgShortcuts";
import { createAdminFixture } from "./fixtures";
import { settleHeadful } from "../test-loading";

afterEach(() => vi.unstubAllGlobals());
it("removes a local shortcut immediately, restores a rejected removal and applies the confirmed receipt once", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createAdminFixture("ready");
  const { orgs } = await fixture("orgs.list", {});
  const org = orgs[0]!;
  const favorite = await fixture("utilities.favorites.set", {
    orgId: org.id,
    label: "Quick Setup",
    destination: "setup",
  });
  let reject!: (error: Error) => void, resolve!: (value: unknown) => void;
  const dispatch = vi.fn(async (operation: string, input: unknown): Promise<unknown> => {
    if (operation === "utilities.favorites.remove")
      return new Promise((done, fail) => {
        resolve = done;
        reject = fail;
      });
    return fixture(operation as Parameters<typeof fixture>[0], input as never);
  });
  const feedback = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <OrgShortcuts
          orgId={org.id}
          workspaceId="shortcuts"
          orgs={[org]}
          dispatch={dispatch}
          onOrgChange={() => {}}
          onNavigate={() => {}}
          onFeedback={feedback}
        />,
      ),
    );
    await settleHeadful(container);
    const remove = () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Remove Quick Setup favorite"]')!;
    await act(async () => {
      remove().click();
    });
    expect(remove()).toBeNull();
    expect(container.textContent).toContain("Removing shortcut…");
    expect(feedback).not.toHaveBeenCalled();
    await act(async () => {
      reject(Error("Local persistence unavailable"));
    });
    expect(remove()).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Local persistence unavailable",
    );
    await act(async () => {
      remove().click();
    });
    await act(async () => {
      resolve({ removed: true });
    });
    expect(remove()).toBeNull();
    expect(feedback).toHaveBeenCalledWith("Removed the shortcut for this org.");
    expect(dispatch.mock.calls.filter(([op]) => op === "utilities.favorites.remove")).toEqual([
      ["utilities.favorites.remove", { orgId: org.id, id: favorite.id }],
      ["utilities.favorites.remove", { orgId: org.id, id: favorite.id }],
    ]);
    expect(dispatch.mock.calls.filter(([op]) => op === "utilities.favorites.list")).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
