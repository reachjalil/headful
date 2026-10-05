// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  headfulUtilityInputSchemas,
  workspacePreferencesSchema,
} from "@t3tools/contracts/headful-utilities";
import type { resolveHeadfulContributions } from "@t3tools/contracts/headful-extensions";
import type { UtilityComponentProps } from "@headfulcloud/admin-utilities/web";
import { HeadfulWorkspaceShell } from "./HeadfulWorkspaceShell";

const contributions: ReturnType<typeof resolveHeadfulContributions> = {
  navigation: [],
  routes: [],
  menuBar: [],
  panels: [],
  actions: [],
  commands: [],
  headerControls: [
    {
      extensionId: "admin-utilities",
      available: true,
      unavailableReason: null,
      contribution: {
        id: "admin-utilities/search",
        name: "Search",
        componentId: "admin-utilities/search",
        placement: "primary",
        defaultVisible: true,
        order: 0,
        workspaceIds: [],
        requiredFeatures: [],
      },
    },
    {
      extensionId: "admin-utilities",
      available: true,
      unavailableReason: null,
      contribution: {
        id: "admin-utilities/status",
        name: "Connection status",
        componentId: "admin-utilities/status",
        placement: "secondary",
        defaultVisible: true,
        order: 1,
        workspaceIds: [],
        requiredFeatures: [],
      },
    },
  ],
};

describe("shared workspace customization", () => {
  let container: HTMLDivElement;
  let root: Root;
  const showModalDescriptor = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "showModal",
  );
  const closeDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (showModalDescriptor)
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModalDescriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    if (closeDescriptor)
      Object.defineProperty(HTMLDialogElement.prototype, "close", closeDescriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  });
  const button = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent?.trim() === name,
    )!;
  const click = async (target: HTMLElement) => {
    await act(async () => target.click());
  };

  it("persists a workspace override, retains the required target, resets to global defaults and restores focus", async () => {
    let stored = workspacePreferencesSchema.parse({
      global: { order: [], hidden: [] },
      overrides: {},
    });
    const dispatch = vi.fn(async (operation: string, input: unknown) => {
      if (operation === "preferences.get") return { workspace: structuredClone(stored) };
      if (operation === "preferences.set") {
        stored = headfulUtilityInputSchemas["preferences.set"].parse(input).workspace;
        return { workspace: structuredClone(stored) };
      }
      throw new Error(`Unexpected operation ${operation}`);
    });
    const onOrgChange = vi.fn();
    const context: UtilityComponentProps = {
      orgId: "example-production",
      workspaceId: "admin-utilities/query",
      dispatch,
      onOrgChange,
      onNavigate: vi.fn(),
      onFeedback: vi.fn(),
      orgs: [
        {
          id: "example-production",
          label: "A very long verified production org label",
          alias: "prod",
          color: "#626dd2",
          isSandbox: false,
          status: "connected",
          username: "admin@example.invalid",
          salesforceOrgId: "00D000000000001AAA",
        },
      ],
    };
    const render = async (workspaceId = "admin-utilities/query", pinned = false) => {
      await act(async () =>
        root.render(
          <div className="hf-shell">
            <HeadfulWorkspaceShell
              title="SOQL"
              context={{ ...context, workspaceId }}
              contributions={contributions}
              commands={[]}
              pinned={pinned}
            >
              <p>Workspace body</p>
            </HeadfulWorkspaceShell>
          </div>,
        ),
      );
    };
    await render();
    const customize = button("Customize workspace");
    await click(customize);
    const scope = container.querySelector<HTMLSelectElement>("dialog select")!;
    await act(async () => {
      scope.value = "workspace";
      scope.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const searchCheckbox = [
      ...container.querySelectorAll<HTMLInputElement>("dialog li input"),
    ].find((input) => input.closest("label")?.textContent?.includes("Search"))!;
    await click(searchCheckbox);
    await click(
      container.querySelector<HTMLButtonElement>('[aria-label="Move Connection status earlier"]')!,
    );
    await click(button("Save preferences"));
    expect(stored.overrides["admin-utilities/query"]).toEqual({
      order: ["admin-utilities/status", "admin-utilities/search"],
      hidden: ["admin-utilities/search"],
    });
    expect(container.querySelectorAll(".hf-workspace-control")).toHaveLength(1);
    const target = container.querySelector<HTMLSelectElement>(
      '[aria-label="Target Salesforce org"]',
    )!;
    expect(target.value).toBe("example-production");
    expect(onOrgChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(customize);
    await render("admin-utilities/schema");
    expect(container.querySelectorAll(".hf-workspace-control")).toHaveLength(2);
    await render();
    expect(container.querySelectorAll(".hf-workspace-control")).toHaveLength(1);
    await click(button("Customize workspace"));
    await click(button("Use global defaults"));
    expect(stored.overrides["admin-utilities/query"]).toBeUndefined();
    expect(container.querySelectorAll(".hf-workspace-control")).toHaveLength(2);
    await render("admin-utilities/query", true);
    expect(
      container.querySelector<HTMLSelectElement>('[aria-label="Target Salesforce org"]')?.disabled,
    ).toBe(true);
    await click(button("Customize workspace"));
    await act(async () =>
      container
        .querySelector("dialog")!
        .dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })),
    );
    expect(document.activeElement).toBe(button("Customize workspace"));
    expect(container.querySelector("dialog")?.open).toBe(false);
  });
});
