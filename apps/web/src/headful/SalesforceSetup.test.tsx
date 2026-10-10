// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { SalesforceSetup } from "./SalesforceSetup";
import { createSetupFixture } from "./setup-fixtures";
import { createAdminFixture } from "./admin-workspace/fixtures";
import type { SetupDispatch } from "./setup-service";
import { settleHeadful } from "./test-loading";

afterEach(() => vi.unstubAllGlobals());
it("shares the top org selection with settings without enabling or retargeting another connection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createAdminFixture("ready");
  await fixture("orgs.update", { orgId: "fixture_development", agentEnabled: true });
  const dispatch = vi.fn(fixture);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const click = async (selector: string) => {
    await act(async () => container.querySelector<HTMLElement>(selector)!.click());
    await settleHeadful(container);
  };
  try {
    await act(async () =>
      root.render(
        <SalesforceSetup
          dispatch={dispatch as SetupDispatch}
          fixture="ready"
          initialStep="workspace"
        />,
      ),
    );
    await click('[aria-label="Settings"]');
    expect(container.querySelector('[data-testid="org-settings-org"]')).toBeNull();
    expect(container.querySelector(".os-org-card h3")?.textContent).toBe("Acme");
    await click('[data-testid="org-switcher"]');
    await click('[data-testid="workspace-org-fixture_development"]');
    expect(container.querySelector(".os-org-card h3")?.textContent).toBe("Acme Development");
    expect(container.querySelector('[data-testid="org-switcher"]')?.textContent).toContain(
      "alex@acme.example.dev",
    );
    expect(history.state.headfulOrgId).toBe("fixture_development");
    expect(dispatch.mock.calls.some(([op]) => op === "orgs.update")).toBe(false);
    expect(dispatch.mock.calls.findLast(([op]) => op === "orgs.overview")?.[1]).toEqual({
      orgId: "fixture_development",
    });
    await click('[data-testid="settings-home"]');
    const current = container.querySelector(
      ".sf-workspace-content > div:not([hidden]) > .sf-admin",
    );
    expect(current?.getAttribute("aria-label")).toBe("Acme Development admin tools");
    expect(dispatch.mock.calls.findLast(([op]) => op === "utilities.objects.list")?.[1]).toEqual({
      orgId: "fixture_development",
      category: "all",
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    history.replaceState(null, "");
  }
});

it("restores an available login from local navigation while rejecting an unavailable remembered org", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createAdminFixture("ready");
  await fixture("orgs.update", { orgId: "fixture_development", agentEnabled: true });
  history.replaceState({ headfulOrgId: "fixture_development" }, "");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<SalesforceSetup dispatch={fixture} fixture="ready" initialStep="workspace" />),
    );
    expect(container.querySelector('[data-testid="org-switcher"]')?.textContent).toContain(
      "alex@acme.example.dev",
    );
    await act(async () => {
      history.replaceState({ headfulOrgId: "fixture_scratch_org" }, "");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(container.querySelector('[data-testid="org-switcher"]')?.textContent).toContain(
      "alex@acme.example",
    );
    expect(
      container
        .querySelector('[data-testid="workspace-org-fixture_scratch_org"]')
        ?.getAttribute("aria-current"),
    ).toBeNull();
    expect((await fixture("orgs.list", {})).orgs.find((org) => org.isDefault)?.id).toBe(
      "fixture_production",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    history.replaceState(null, "");
  }
});
it("recovers from missing CLI on refocus and persists org opt-in before finishing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let fixture = createSetupFixture("missing");
  const dispatch = vi.fn((operation, input) =>
    fixture(operation, input),
  ) as unknown as SetupDispatch;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const button = (text: string) =>
    [...container.querySelectorAll("button")].find((element) =>
      element.textContent?.includes(text),
    )!;
  try {
    await act(async () => root.render(<SalesforceSetup dispatch={dispatch} />));
    await act(async () => button("Get started").click());
    expect(container.textContent).toContain("Install Salesforce CLI");
    expect(button("Choose orgs").disabled).toBe(true);
    fixture = createSetupFixture("ready");
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.textContent).toContain("Salesforce CLI is ready");
    await act(async () => button("Choose orgs").click());
    const toggle = container.querySelector<HTMLButtonElement>(
      '[aria-label="Enable Acme Development"]',
    )!;
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => button("Open Headful").click());
    expect(await fixture("features.list", {})).toHaveProperty("onboardingComplete", true);
    expect(container.querySelector("header")).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("keeps failed discovery visible and does not present stale orgs as connected", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createSetupFixture("ready");
  const dispatch = (async (operation, input) => {
    if (operation === "orgs.discover") throw new Error("Fixture CLI failure");
    return fixture(operation, input);
  }) as SetupDispatch;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SalesforceSetup dispatch={dispatch} initialStep="orgs" />));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain("CLI login missing");
    expect(
      [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')].every(
        (element) => element.disabled,
      ),
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("opens a navigable settings page during onboarding and keeps fixture native authority blocked", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let navigate: ((route: string) => void) | undefined;
  const nativeDispatch = vi.fn();
  vi.stubGlobal("headfulBridge", {
    dispatch: nativeDispatch,
    onNavigate: (listener: (route: string) => void) => {
      navigate = listener;
      return () => {};
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <SalesforceSetup
          dispatch={createSetupFixture("missing")}
          fixture="missing"
          initialStep="welcome"
        />,
      ),
    );
    await act(async () => navigate?.("mods?modId=org.example.controls"));
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.querySelector('[data-testid="settings-page"]')).not.toBeNull();
    expect(
      container
        .querySelector('[aria-label="Settings sections"] [aria-current="page"]')
        ?.textContent?.trim(),
    ).toBe("Local mods");
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="mods-install"]')?.disabled,
    ).toBe(true);
    expect(nativeDispatch).not.toHaveBeenCalled();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="settings-home"]')!.click(),
    );
    expect(container.querySelector('[data-testid="settings-page"]')).toBeNull();
    expect(container.textContent).toContain("Welcome to Headful");
    await act(async () => {
      history.replaceState({ headfulNavigation: { view: "settings", page: "connections" } }, "");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(
      container
        .querySelector('[aria-label="Settings sections"] [aria-current="page"]')
        ?.textContent?.trim(),
    ).toBe("Connections");
    expect(container.querySelector("dialog")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    history.replaceState(null, "");
  }
});

it("keeps browser sign-in progress truthful and restores the form after a failed login", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let failLogin!: (error: Error) => void;
  const pendingLogin = new Promise<never>((_resolve, reject) => {
    failLogin = reject;
  });
  const fixture = createSetupFixture("empty");
  const dispatch: SetupDispatch = (operation, input) =>
    operation === "orgs.login" ? pendingLogin : fixture(operation, input);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<SalesforceSetup dispatch={dispatch} fixture="empty" initialStep="orgs" />),
    );
    await settleHeadful(container);
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((b) => b.textContent?.includes("Add org"))!
        .click(),
    );
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(container.querySelector("form [role=status]")?.textContent).toContain(
      "Finish signing in in your browser",
    );
    expect(container.querySelector<HTMLButtonElement>("form .sf-primary")?.disabled).toBe(true);
    await act(async () => failLogin(new Error("Browser login was cancelled.")));
    expect(container.querySelector("form [role=status]")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>("form .sf-primary")?.disabled).toBe(false);
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "could not complete this step",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    history.replaceState(null, "");
  }
});
