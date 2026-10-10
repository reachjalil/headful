// @vitest-environment jsdom
import { act } from "react";
import { EditorView } from "@codemirror/view";
import { settleHeadful } from "../test-loading";
import { headfulUtilityResultSchemas } from "@t3tools/contracts/headful-utilities";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { AdminWorkspace } from "./AdminWorkspace";
import { createAdminFixture } from "./fixtures";
import { SalesforceSetup } from "../SalesforceSetup";
import type { SetupDispatch } from "../setup-service";

afterEach(() => vi.unstubAllGlobals());
async function mount(view: React.ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(view));
  await settleHeadful(container);
  return {
    container,
    render: async (view: React.ReactNode) => {
      await act(async () => root.render(view));
      await settleHeadful(container);
    },
    click: async (id: string) => {
      await act(async () =>
        container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click(),
      );
      await settleHeadful(container);
    },
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
function text(element: HTMLElement) {
  return EditorView.findFromDOM(element)!.state.doc.toString();
}
async function type(element: HTMLElement, value: string) {
  const editor = EditorView.findFromDOM(element)!;
  await act(async () =>
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } }),
  );
}

it("preserves query drafts across tools and opens org-pinned record inputs without an automatic read", async () => {
  const fixture = createAdminFixture("ready");
  const dispatch = vi.fn(fixture);
  const { orgs } = await fixture("orgs.list", {});
  const { mods } = await fixture("mods.list", {});
  const { features } = await fixture("features.list", {});
  const f = await mount(
    <AdminWorkspace
      mods={mods}
      features={features}
      org={orgs[0]!}
      dispatch={dispatch as SetupDispatch}
    />,
  );
  try {
    await f.click("admin-object-account");
    await f.click("admin-open-query");
    expect(dispatch.mock.calls.some(([op]) => op === "utilities.query.run")).toBe(false);
    const editor = f.container.querySelector<HTMLElement>('[data-testid="admin-query-editor"]')!;
    const query = "SELECT Id, Name FROM Account LIMIT 10";
    await type(editor, query);
    await f.click("admin-tool-health");
    await f.click("admin-tool-query");
    expect(f.container.querySelector('[data-testid="admin-query-editor"]')).toBe(editor);
    expect(text(editor)).toBe(query);
    await f.click("admin-run-query");
    expect(f.container.textContent).toContain("Acme Example");
    await act(async () =>
      f.container
        .querySelector<HTMLButtonElement>('[aria-label="Inspect record 001000000000001AAA"]')!
        .click(),
    );
    await settleHeadful(f.container);
    expect(
      f.container.querySelector<HTMLInputElement>('[data-testid="admin-record-id"]')?.value,
    ).toBe("001000000000001AAA");
    expect(dispatch.mock.calls.some(([op]) => op === "utilities.record.get")).toBe(false);
    await f.click("admin-inspect-record");
    const reads = dispatch.mock.calls.filter(
      ([operation]) => operation === "utilities.record.get",
    ).length;
    await f.click("editor-back");
    expect(text(editor)).toBe(query);
    expect(
      f.container.querySelector('[data-testid="admin-panel-query"]')?.hasAttribute("hidden"),
    ).toBe(false);
    await f.click("editor-forward");
    expect(
      f.container.querySelector<HTMLInputElement>('[data-testid="admin-record-id"]')?.value,
    ).toBe("001000000000001AAA");
    expect(
      dispatch.mock.calls.filter(([operation]) => operation === "utilities.record.get"),
    ).toHaveLength(reads);
    await f.click("editor-back");
    await f.click("admin-tool-health");
    expect(
      f.container.querySelector<HTMLButtonElement>('[data-testid="editor-forward"]')?.disabled,
    ).toBe(true);
    for (const [operation, input] of dispatch.mock.calls) {
      if (operation.startsWith("utilities.")) expect(input).toHaveProperty("orgId", orgs[0]!.id);
    }
  } finally {
    await f.close();
  }
});

it("searches tools and scoped actions from the keyboard without executing a query, and ignores hidden workspaces", async () => {
  const fixture = createAdminFixture("ready", true);
  const dispatch = vi.fn(fixture);
  const { orgs } = await fixture("orgs.list", {});
  const { mods } = await fixture("mods.list", {});
  const { features } = await fixture("features.list", {});
  const f = await mount(
    <AdminWorkspace
      org={orgs[0]!}
      mods={mods}
      features={features}
      dispatch={dispatch as SetupDispatch}
    />,
  );
  const press = async (target: EventTarget, key: string, extras: KeyboardEventInit = {}) => {
    await act(async () =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extras }),
      ),
    );
    await settleHeadful(f.container);
  };
  const find = async (value: string) => {
    const input = f.container.querySelector<HTMLInputElement>(
      '[data-testid="editor-tools-search"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
  };
  try {
    const menu = f.container.querySelector<HTMLDetailsElement>(".sf-editor-menu")!;
    await press(window, "k", { metaKey: true });
    expect(menu.open).toBe(true);
    expect(document.activeElement).toBe(
      f.container.querySelector('[data-testid="editor-tools-search"]'),
    );
    const input = await find("soql");
    await press(input, "ArrowDown");
    expect(document.activeElement).toBe(
      f.container.querySelector('[data-testid="editor-tool-headful.admin-utilities/query"]'),
    );
    await act(async () => (document.activeElement as HTMLButtonElement).click());
    await settleHeadful(f.container);
    expect(menu.open).toBe(false);
    expect(
      f.container.querySelector('[data-testid="admin-panel-query"]')?.hasAttribute("hidden"),
    ).toBe(false);
    expect(dispatch.mock.calls.some(([op]) => op === "utilities.query.run")).toBe(false);
    await press(window, "k", { ctrlKey: true });
    await find("does not exist");
    await press(input, "Enter");
    expect(menu.open).toBe(true);
    expect(menu.textContent).toContain("No matching tools or actions");
    await find("counter");
    await press(input, "Enter");
    expect(f.container.textContent).toContain("Invocations: 0.");
    await press(window, "k", { metaKey: true });
    await find("hello");
    expect(
      f.container.querySelector('[data-testid="editor-menu-action-org.example.hello/hello"]'),
    ).not.toBeNull();
    await find("say hello");
    await press(input, "Enter");
    expect(dispatch.mock.calls.filter(([op]) => op === "mods.command")).toHaveLength(1);
    await press(window, "k", { metaKey: true });
    await press(input, "Escape");
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(menu.querySelector("summary"));
    f.container.hidden = true;
    await press(window, "k", { metaKey: true });
    expect(menu.open).toBe(false);
    expect(f.container.querySelector("dialog, [role=dialog]")).toBeNull();
  } finally {
    await f.close();
  }
});

it("skips replaced and revoked mod history without repeating actions or restoring old content", async () => {
  const fixture = createAdminFixture("ready", true);
  const dispatch = vi.fn(fixture);
  const { orgs } = await fixture("orgs.list", {});
  const { mods } = await fixture("mods.list", {});
  const { features } = await fixture("features.list", {});
  const view = (current: typeof mods) => (
    <AdminWorkspace
      org={orgs[0]!}
      mods={current}
      features={features}
      dispatch={dispatch as SetupDispatch}
    />
  );
  const f = await mount(view(mods));
  try {
    await f.click("admin-tool-query");
    await f.click("editor-tools-menu");
    await f.click("editor-tool-org.example.hello/counter");
    await f.click("admin-tool-record");
    const replaced = mods.map((mod) =>
      mod.manifest.id === "org.example.hello" ? { ...mod, artifactRevision: "replacement" } : mod,
    );
    await f.render(view(replaced));
    await f.click("editor-back");
    expect(
      f.container.querySelector('[data-testid="admin-panel-query"]')?.hasAttribute("hidden"),
    ).toBe(false);
    await f.click("editor-forward");
    expect(
      f.container.querySelector('[data-testid="admin-panel-record"]')?.hasAttribute("hidden"),
    ).toBe(false);
    await f.click("editor-tools-menu");
    await f.click("editor-tool-org.example.hello/counter");
    await f.click("admin-tool-health");
    const revoked = replaced.map((mod) =>
      mod.manifest.id === "org.example.hello"
        ? { ...mod, enabled: false, status: "disabled" as const }
        : mod,
    );
    await f.render(view(revoked));
    await f.click("editor-back");
    expect(
      f.container.querySelector('[data-testid="admin-panel-record"]')?.hasAttribute("hidden"),
    ).toBe(false);
    expect(f.container.querySelector('[aria-label="Local counter"]')).toBeNull();
    expect(
      dispatch.mock.calls.some(
        ([op]) =>
          op === "mods.command" || op === "utilities.query.run" || op === "utilities.record.get",
      ),
    ).toBe(false);
  } finally {
    await f.close();
  }
});

it("opens a declared community tool in the editor, scopes its action, preserves the query draft and removes revoked content", async () => {
  const fixture = createAdminFixture("ready", true);
  const dispatch = vi.fn(fixture);
  const { orgs } = await fixture("orgs.list", {});
  const { mods } = await fixture("mods.list", {});
  const { features } = await fixture("features.list", {});
  const view = (current: typeof mods) => (
    <AdminWorkspace
      org={orgs[0]!}
      mods={current}
      features={features}
      dispatch={dispatch as SetupDispatch}
      initialTool="query"
    />
  );
  const f = await mount(view(mods));
  try {
    const editor = f.container.querySelector<HTMLElement>('[data-testid="admin-query-editor"]')!;
    await type(editor, "SELECT Id FROM User LIMIT 25");
    expect(
      f.container.querySelector('[data-testid="editor-action-org.example.hello/hello"]'),
    ).toBeNull();
    await act(async () =>
      f.container.querySelector<HTMLElement>('[data-testid="editor-tools-menu"]')!.click(),
    );
    await f.click("editor-tool-org.example.hello/counter");
    expect(f.container.textContent).toContain("Invocations: 0.");
    await f.click("editor-action-org.example.hello/hello");
    expect(dispatch.mock.calls.filter(([operation]) => operation === "mods.command")).toEqual([
      [
        "mods.command",
        {
          id: "org.example.hello",
          command: "org.example.hello/hello",
          input: {},
          artifactRevision: "fixture-counter",
        },
      ],
    ]);
    await f.click("editor-refresh-view");
    expect(f.container.textContent).toContain("Invocations: 1.");
    await f.click("admin-tool-query");
    expect(text(editor)).toBe("SELECT Id FROM User LIMIT 25");
    const revoked = mods.map((mod) =>
      mod.manifest.id === "org.example.hello"
        ? { ...mod, enabled: false, status: "disabled" as const }
        : mod,
    );
    await f.render(view(revoked));
    expect(f.container.querySelector('[aria-label="Local counter"]')).toBeNull();
    expect(
      f.container.querySelector<HTMLButtonElement>(
        '[data-testid="editor-tool-org.example.hello/counter"]',
      )?.disabled,
    ).toBe(true);
    expect(text(editor)).toBe("SELECT Id FROM User LIMIT 25");
  } finally {
    await f.close();
  }
});

it("uses the pinned org for a declared org action and reports a native rejection without retrying", async () => {
  const fixture = createAdminFixture("ready");
  const dispatch = vi.fn(async (...args: Parameters<SetupDispatch>) => {
    if (args[0] === "mods.command") throw new Error("The mod was revoked.");
    return fixture(...args);
  });
  const { orgs } = await fixture("orgs.list", {});
  const { mods } = await fixture("mods.list", {});
  const { features } = await fixture("features.list", {});
  const f = await mount(
    <AdminWorkspace
      org={orgs[0]!}
      mods={mods}
      features={features}
      dispatch={dispatch as SetupDispatch}
    />,
  );
  try {
    await act(async () =>
      f.container.querySelector<HTMLElement>('[data-testid="editor-tools-menu"]')!.click(),
    );
    await f.click("editor-menu-action-headful.admin-utilities/open-setup");
    expect(dispatch.mock.calls.filter(([op]) => op === "mods.command")).toEqual([
      [
        "mods.command",
        {
          id: mods[0]!.manifest.id,
          command: "headful.admin-utilities/open-setup",
          input: { "org-id": orgs[0]!.id },
          artifactRevision: "fixture-admin",
        },
      ],
    ]);
    expect(f.container.querySelector('[role="status"]')?.textContent).toContain(
      "The mod was revoked.",
    );
  } finally {
    await f.close();
  }
});

it("keeps each org’s draft and mounted tools through successful connection rechecks", async () => {
  const fixture = createAdminFixture("ready");
  await fixture("orgs.update", { orgId: "fixture_development", agentEnabled: true });
  const f = await mount(<SalesforceSetup dispatch={fixture} initialStep="workspace" />);
  try {
    await f.click("admin-tool-query");
    const editor = f.container.querySelector<HTMLElement>('[data-testid="admin-query-editor"]')!;
    const query = "SELECT Id FROM User LIMIT 25";
    await type(editor, query);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(f.container.querySelector('[data-testid="admin-query-editor"]')).toBe(editor);
    expect(text(editor)).toBe(query);
    await act(async () =>
      f.container.querySelector<HTMLElement>('[data-testid="org-switcher"]')!.click(),
    );
    await f.click("workspace-org-fixture_development");
    expect(f.container.querySelector('[data-testid="org-switcher"]')?.textContent).toContain(
      "alex@acme.example.dev",
    );
    const development = f.container.querySelector<HTMLElement>(".sf-org-workspace:not([hidden])")!;
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, cancelable: true }),
      ),
    );
    expect(development.querySelector<HTMLDetailsElement>(".sf-editor-menu")?.open).toBe(true);
    expect(
      f.container.querySelector<HTMLDetailsElement>(".sf-org-workspace[hidden] .sf-editor-menu")
        ?.open,
    ).toBe(false);
    const search = development.querySelector<HTMLInputElement>(
      '[data-testid="editor-tools-search"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        search,
        "query",
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      search.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      ),
    );
    await settleHeadful(f.container);
    expect(
      development.querySelector<HTMLButtonElement>('[data-testid="editor-back"]')?.disabled,
    ).toBe(false);
    expect(
      text(development.querySelector<HTMLElement>('[data-testid="admin-query-editor"]')!),
    ).not.toBe(query);
    await act(async () =>
      f.container.querySelector<HTMLElement>('[data-testid="org-switcher"]')!.click(),
    );
    await f.click("workspace-org-fixture_production");
    expect(
      text(
        f.container.querySelector<HTMLElement>(
          '.sf-org-workspace:not([hidden]) [data-testid="admin-query-editor"]',
        )!,
      ),
    ).toBe(query);
    expect(editor.isConnected).toBe(true);
    const production = f.container.querySelector<HTMLElement>(".sf-org-workspace:not([hidden])")!;
    await act(async () =>
      production.querySelector<HTMLButtonElement>('[data-testid="editor-back"]')!.click(),
    );
    expect(
      production.querySelector('[data-testid="admin-panel-schema"]')?.hasAttribute("hidden"),
    ).toBe(false);
    await act(async () =>
      production.querySelector<HTMLButtonElement>('[data-testid="editor-forward"]')!.click(),
    );
    expect(text(editor)).toBe(query);
  } finally {
    await f.close();
  }
});

it("shows unavailable reads once and keeps alternate tasks reachable", async () => {
  const fixture = createAdminFixture("expired");
  const dispatch = vi.fn(fixture);
  const { orgs } = await fixture("orgs.list", {});
  const { mods } = await fixture("mods.list", {});
  const { features } = await fixture("features.list", {});
  const f = await mount(
    <AdminWorkspace
      mods={mods}
      features={features}
      org={orgs[0]!}
      dispatch={dispatch as SetupDispatch}
    />,
  );
  try {
    expect(f.container.querySelector('[role="alert"]')?.textContent).toContain("Connections & CLI");
    expect(dispatch.mock.calls.filter(([op]) => op === "utilities.objects.list")).toHaveLength(1);
    await f.click("admin-tool-record");
    expect(
      f.container
        .querySelector<HTMLButtonElement>('[data-testid="admin-tool-record"]')
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(dispatch.mock.calls.some(([op]) => op === "utilities.record.get")).toBe(false);
  } finally {
    await f.close();
  }
});

it("inspects calculated fields in place, keeps unavailable formula source explicit and renders org-scoped docs", async () => {
  const fixture = createAdminFixture("ready");
  const dispatch = vi.fn(async (...args: Parameters<SetupDispatch>) => {
    const result = await fixture(...args);
    if (args[0] === "utilities.objects.describe") {
      const description = headfulUtilityResultSchemas["utilities.objects.describe"].parse(result);
      return {
        ...description,
        fields: description.fields.map((field) =>
          field.calculated ? { ...field, calculatedFormula: null } : field,
        ),
      };
    }
    return result;
  });
  const { orgs } = await fixture("orgs.list", {});
  const { mods } = await fixture("mods.list", {});
  const { features } = await fixture("features.list", {});
  const f = await mount(
    <AdminWorkspace
      org={orgs[0]!}
      mods={mods}
      features={features}
      dispatch={dispatch as SetupDispatch}
    />,
  );
  try {
    await f.click("admin-object-account");
    await f.click("admin-inspect-field-annual-revenue-band--c");
    expect(f.container.textContent).toContain("Salesforce did not return formula source");
    expect(f.container.querySelector("dialog, [role=dialog]")).toBeNull();
    await f.click("admin-schema-documentation");
    const doc = f.container.querySelector<HTMLElement>(
      '[aria-label="Account field documentation"]',
    )!;
    expect(doc.textContent).toContain(orgs[0]!.salesforceOrgId);
    expect(doc.querySelectorAll("tbody tr")).toHaveLength(7);
    expect(dispatch.mock.calls.some(([operation]) => operation === "utilities.query.run")).toBe(
      false,
    );
    await f.click("admin-schema-fields");
    await f.click("admin-open-query");
    expect(
      dispatch.mock.calls.every(
        ([operation, input]) =>
          !operation.startsWith("utilities.") || (input as { orgId: string }).orgId === orgs[0]!.id,
      ),
    ).toBe(true);
  } finally {
    await f.close();
  }
});

it("keeps local query work through reference panel navigation and loads saved text without running it", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 0;
  });
  const fixture = createAdminFixture("ready");
  const dispatch = vi.fn(fixture);
  const { orgs } = await fixture("orgs.list", {});
  const { mods } = await fixture("mods.list", {});
  const { features } = await fixture("features.list", {});
  const f = await mount(
    <AdminWorkspace
      mods={mods}
      features={features}
      org={orgs[0]!}
      dispatch={dispatch as SetupDispatch}
      initialTool="query"
    />,
  );
  try {
    const editor = f.container.querySelector<HTMLElement>('[data-testid="admin-query-editor"]')!;
    const query = "SELECT Id, Name FROM Account LIMIT 10";
    await type(editor, query);
    await f.click("admin-query-reference-close");
    expect(
      f.container.querySelector<HTMLElement>('[data-testid="admin-query-reference"]')?.hidden,
    ).toBe(true);
    expect(text(editor)).toBe(query);
    await f.click("admin-save-query-open");
    const name = f.container.querySelector<HTMLInputElement>('[aria-label="Saved queries"] input')!;
    expect(document.activeElement).toBe(name);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        name,
        "Accounts ten",
      );
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await f.click("admin-query-reference-fields");
    await f.click("admin-query-reference-saved");
    expect(name.value).toBe("Accounts ten");
    await act(async () =>
      name.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(dispatch.mock.calls.filter(([op]) => op === "utilities.saved.set")).toHaveLength(1);
    await type(editor, "SELECT Id FROM User LIMIT 3");
    const saved = [
      ...f.container.querySelectorAll<HTMLButtonElement>('[aria-label="Saved queries"] button'),
    ].find((button) => button.textContent === "Accounts ten")!;
    await act(async () => saved.click());
    expect(text(editor)).toBe(query);
    expect(dispatch.mock.calls.some(([op]) => op === "utilities.query.run")).toBe(false);
    await f.click("admin-run-query");
    await type(editor, "SELECT Id FROM User LIMIT 3");
    expect(f.container.textContent).toContain("Editor changed");
    expect(f.container.querySelector(".hf-query-executed code")?.textContent).toBe(query);
    for (const [op, input] of dispatch.mock.calls)
      if (op.startsWith("utilities.")) expect(input).toHaveProperty("orgId", orgs[0]!.id);
  } finally {
    await f.close();
  }
});
