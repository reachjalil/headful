// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { headfulResultSchemas } from "@t3tools/contracts/headful";
import { mountWorkspace, type WorkspaceOptions } from "./workspace-view";
import { HeadfulShell } from "./HeadfulShell";

vi.mock("./workspace-view", () => ({ mountWorkspace: vi.fn() }));

const productionId = "org_production_001";
const sandboxId = "org_sandbox_00001";
const workflowId = "workflow_saved_001";
const status = headfulResultSchemas.status.parse({
  product: "Headful",
  protocol: "headful-local-v1",
  local: true,
  accountRequired: false,
  defaultOrgId: productionId,
  mode: "power-user",
  onboardingComplete: true,
  features: ["org-management", "salesforce-workspace", "reviewed-changes"].map((id) => ({
    id,
    name: id,
    description: "Fixture feature",
    availability: "available",
    enabled: true,
    defaultEnabled: true,
    dependencies: [],
    configuration: [],
    permissions: [],
    route: "workspace",
    lifecycle: "on-demand",
  })),
  orgs: [
    {
      id: productionId,
      label: "Acme Production",
      salesforceOrgId: "00D000000000001AAA",
      instanceOrigin: "https://acme.example.test",
      status: "connected",
      createdAt: 1,
      isSandbox: false,
      organizationName: "Acme",
      username: "admin@example.test",
      principalId: "005000000000001AAA",
      alias: "production",
      color: "#626dd2",
      agentEnabled: false,
      remoteEnabled: false,
      isDefault: true,
      connectionVersion: 1,
    },
    {
      id: sandboxId,
      label: "Acme Sandbox",
      salesforceOrgId: "00D000000000002AAA",
      instanceOrigin: "https://sandbox.example.test",
      status: "connected",
      createdAt: 2,
      isSandbox: true,
      organizationName: "Acme",
      username: "admin.sandbox@example.test",
      principalId: "005000000000002AAA",
      alias: "sandbox",
      color: "#3ba8a1",
      agentEnabled: false,
      remoteEnabled: false,
      isDefault: false,
      connectionVersion: 1,
    },
  ],
});
const sandbox = status.orgs.find((org) => org.id === sandboxId);
if (!sandbox) throw new Error("Fixture sandbox was not constructed");
const savedWorkflows = headfulResultSchemas.listWorkflows.parse({
  workflows: [
    {
      id: workflowId,
      orgId: sandboxId,
      originatingGrantId: null,
      intent: "create-user",
      status: "prepared",
      revision: 1,
      digest: null,
      recordId: null,
      setup: {
        org: {
          id: sandbox.id,
          label: sandbox.label,
          salesforceOrgId: sandbox.salesforceOrgId,
          instanceOrigin: sandbox.instanceOrigin,
          status: sandbox.status,
          createdAt: sandbox.createdAt,
          isSandbox: sandbox.isSandbox,
          organizationName: sandbox.organizationName,
        },
        isSandbox: true,
        fields: [],
        profiles: [],
        licenses: [],
        defaults: {},
        unsupportedRequiredFields: [],
        bounded: true,
      },
      draft: { LastName: "Chen" },
      operationHistory: [],
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  limit: 50,
  bounded: true,
});
const cli = headfulResultSchemas["cli.detect"].parse({
  state: "ready",
  selected: "/usr/local/bin/sf",
  installations: [
    { path: "/usr/local/bin/sf", version: "2.100.0", supported: true, source: "path" },
  ],
  architecture: "arm64",
  legacyDetected: false,
  installerUrl: "https://developer.salesforce.com/tools/salesforcecli",
});

describe("Headful shell explicit destination routing", () => {
  let container: HTMLDivElement;
  let root: Root;
  const showModalDescriptor = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "showModal",
  );
  const closeDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  const dispatch = vi.fn(async (operation: string, _input: unknown) => {
    switch (operation) {
      case "status":
        return status;
      case "extensions.list":
        return { apiVersion: 1, extensions: [] };
      case "cli.detect":
        return cli;
      case "listWorkflows":
        return savedWorkflows;
      case "activity.list":
        return { activity: [], bounded: true };
      case "preferences.get":
        return { workspace: { global: { order: [], hidden: [] }, overrides: {} } };
      default:
        throw new Error(`Unexpected dispatch ${operation}`);
    }
  });

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("matchMedia", () => Object.assign(new EventTarget(), { matches: false }));
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
    vi.mocked(mountWorkspace).mockImplementation(
      (element, _service, options: WorkspaceOptions = {}) => {
        const placeholder = document.createElement("pre");
        placeholder.setAttribute("aria-label", "Opened workspace location");
        placeholder.textContent = JSON.stringify(options.initial);
        element.append(placeholder);
        return {
          destroy: () => placeholder.remove(),
          navigate: async () => {},
          refresh: async () => {},
          getLocation: () => ({ view: "home", ...options.initial }),
          setRecordInspector: () => {},
        };
      },
    );
    dispatch.mockClear();
    window.headfulBridge = { dispatch };
    localStorage.clear();
    history.replaceState(null, "", "/");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete window.headfulBridge;
    localStorage.clear();
    history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (showModalDescriptor)
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModalDescriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    if (closeDescriptor)
      Object.defineProperty(HTMLDialogElement.prototype, "close", closeDescriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  });

  function targetSelector() {
    const target = container.querySelector<HTMLSelectElement>(
      '[aria-label="Target Salesforce org"]',
    );
    if (!target) throw new Error("Workspace target selector was not rendered");
    return target;
  }
  function topbar() {
    return container.querySelector(".hf-topbar")?.textContent;
  }
  async function returnToOrgs() {
    const button = [...container.querySelectorAll<HTMLButtonElement>(".hf-nav-button")].find(
      (item) => item.textContent?.includes("Your orgs"),
    );
    if (!button) throw new Error("Your orgs navigation was not rendered");
    await act(async () => button.click());
  }
  function assertReadOnlyRouting() {
    const operations = dispatch.mock.calls.map(([operation]) => operation);
    expect(operations).not.toContain("orgs.default");
    expect(
      operations.every((operation) =>
        [
          "status",
          "extensions.list",
          "cli.detect",
          "listWorkflows",
          "activity.list",
          "preferences.get",
        ].includes(operation),
      ),
    ).toBe(true);
  }

  it("opens a searched sandbox atomically without replacing it with the production default", async () => {
    await act(async () => root.render(<HeadfulShell />));
    expect(topbar()).toContain("Acme Production");
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true }),
      ),
    );
    const input = container.querySelector<HTMLInputElement>('input[role="combobox"]');
    if (!input) throw new Error("Search did not open");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setValue) throw new Error("Native input setter is unavailable");
    await act(async () => {
      setValue.call(input, "Acme Sandbox");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(targetSelector().value).toBe(sandboxId);
    expect(targetSelector().disabled).toBe(false);
    expect(topbar()).toContain("Acme Sandbox");
    expect(container.querySelector('[aria-label="Opened workspace location"]')?.textContent).toBe(
      JSON.stringify({ orgId: sandboxId, view: "home" }),
    );
    expect(location.hash).toContain(`orgId=${sandboxId}`);
    await returnToOrgs();
    expect(topbar()).toContain("Acme Production");
    assertReadOnlyRouting();
  });

  it("opens a notification at its saved sandbox workflow with a pinned target and unchanged default", async () => {
    await act(async () => root.render(<HeadfulShell />));
    const notifications = container.querySelector<HTMLButtonElement>(
      '[aria-label^="Notifications"]',
    );
    if (!notifications) throw new Error("Notifications were not rendered");
    await act(async () => notifications.click());
    const savedWork = container.querySelector<HTMLButtonElement>(".hf-inbox-item-open");
    if (!savedWork) throw new Error("Prepared workflow notification was not rendered");
    expect(savedWork.textContent).toContain("User creation ready to review");
    expect(savedWork.textContent).toContain("Acme Sandbox");
    await act(async () => savedWork.click());
    expect(targetSelector().value).toBe(sandboxId);
    expect(targetSelector().disabled).toBe(true);
    expect(topbar()).toContain("Acme Sandbox");
    expect(container.querySelector('[aria-label="Opened workspace location"]')?.textContent).toBe(
      JSON.stringify({ view: "create-user", orgId: sandboxId, workflowId }),
    );
    expect(location.hash).toContain(`workflowId=${workflowId}`);
    expect(location.hash).toContain(`orgId=${sandboxId}`);
    await returnToOrgs();
    expect(topbar()).toContain("Acme Production");
    assertReadOnlyRouting();
  });
});
