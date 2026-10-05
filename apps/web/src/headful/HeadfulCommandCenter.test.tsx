// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { HeadfulCommandCenter, useHeadfulInbox } from "./HeadfulCommandCenter";
import type { NotificationEntry, SearchEntry } from "./command-center";

const entries: SearchEntry[] = [
  {
    id: "production",
    title: "Acme Production",
    description: "Production org",
    group: "Orgs",
    destination: { kind: "org", orgId: "org_production_001" },
  },
  {
    id: "sandbox",
    title: "Acme Sandbox",
    description: "Sandbox org",
    group: "Orgs",
    destination: { kind: "org", orgId: "org_sandbox_00001" },
  },
  {
    id: "settings",
    title: "Settings",
    description: "Salesforce CLI setup",
    group: "Pages",
    destination: { kind: "page", page: "settings" },
  },
];
const workflowNotification: NotificationEntry = {
  id: "workflow:workflow_saved_001:1:prepared",
  title: "User creation ready to review",
  description: "Fictional Acme Salesforce user draft",
  level: "info",
  destination: {
    kind: "workspace",
    location: {
      view: "create-user",
      orgId: "org_production_001",
      workflowId: "workflow_saved_001",
    },
  },
};
const cliNotification: NotificationEntry = {
  id: "cli:missing:none",
  title: "Salesforce CLI is missing",
  description: "Configure Salesforce CLI in Settings",
  level: "warning",
  destination: { kind: "page", page: "settings" },
};
const savedActivity = {
  id: 41,
  kind: "permission_change_prepared",
  org_id: "org_production_001",
  target_id: "proposal_saved_001",
  created_at: 100,
};
const workflowResponse = { workflows: [], limit: 50, bounded: true };
const activityResponse = { activity: [savedActivity], bounded: true };

function deferred<T>() {
  let resolve: (value: T) => void = (_value: T) => {
    throw new Error("Deferred has not initialized");
  };
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function InboxProbe(props: Parameters<typeof useHeadfulInbox>[0]) {
  const inbox = useHeadfulInbox(props);
  return (
    <>
      <output aria-label="Inbox loading">{String(inbox.loading)}</output>
      <output aria-label="Inbox error">{inbox.error}</output>
      <ul aria-label="Loaded activity">
        {inbox.activity.map((event) => (
          <li key={event.id}>{event.id}</li>
        ))}
      </ul>
    </>
  );
}

describe("Headful command center journeys", () => {
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
    localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (showModalDescriptor)
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModalDescriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    if (closeDescriptor)
      Object.defineProperty(HTMLDialogElement.prototype, "close", closeDescriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  });

  function button(name: string) {
    const result = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.getAttribute("aria-label") === name || item.textContent?.trim() === name,
    );
    if (!result) throw new Error(`Button ${name} was not rendered`);
    return result;
  }
  const click = async (element: HTMLElement) => {
    await act(async () => element.click());
  };
  const dialog = () => container.querySelector("dialog");
  const notificationsTrigger = () => {
    const result = container.querySelector<HTMLButtonElement>('[aria-label^="Notifications"]');
    if (!result) throw new Error("Notifications trigger was not rendered");
    return result;
  };
  async function shortcut(options: KeyboardEventInit) {
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          bubbles: true,
          cancelable: true,
          ...options,
        }),
      ),
    );
  }
  async function cancelDialog() {
    const element = dialog();
    if (!element) throw new Error("Dialog was not rendered");
    // Escape is implemented by the native dialog's cancel event.
    await act(async () =>
      element.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })),
    );
  }

  it("focuses search with Meta+K, filters typed queries and opens the keyboard-selected org", async () => {
    const onNavigate = vi.fn();
    const onRefresh = vi.fn();
    await act(async () =>
      root.render(
        <HeadfulCommandCenter
          entries={entries}
          notifications={[]}
          loading={false}
          error=""
          onRefresh={onRefresh}
          onNavigate={onNavigate}
        />,
      ),
    );
    await shortcut({ metaKey: true });
    const input = container.querySelector<HTMLInputElement>('input[role="combobox"]');
    if (!input) throw new Error("Search did not open");
    expect(document.activeElement).toBe(input);
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setValue) throw new Error("Native input value setter is unavailable");
    await act(async () => {
      setValue.call(input, "acme");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith({ kind: "org", orgId: "org_sandbox_00001" });
    expect(dialog()?.open).toBe(false);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("restores the original focus on native Escape cancellation and leaves Ctrl+Shift+K for workspace search", async () => {
    await act(async () =>
      root.render(
        <>
          <button type="button">Workspace control</button>
          <HeadfulCommandCenter
            entries={entries}
            notifications={[]}
            loading={false}
            error=""
            onRefresh={vi.fn()}
            onNavigate={vi.fn()}
          />
        </>,
      ),
    );
    const original = button("Workspace control");
    original.focus();
    await shortcut({ ctrlKey: true, shiftKey: true });
    expect(dialog()?.open).toBe(false);
    expect(document.activeElement).toBe(original);
    await shortcut({ metaKey: true });
    expect(dialog()?.open).toBe(true);
    await cancelDialog();
    expect(dialog()?.open).toBe(false);
    expect(document.activeElement).toBe(original);
  });

  it("persists read and dismissed IDs across remounts and treats a later workflow revision as unread", async () => {
    const onNavigate = vi.fn();
    const render = async (notifications = [workflowNotification, cliNotification]) => {
      await act(async () =>
        root.render(
          <HeadfulCommandCenter
            entries={entries}
            notifications={notifications}
            loading={false}
            error=""
            onRefresh={vi.fn()}
            onNavigate={onNavigate}
          />,
        ),
      );
    };
    await render();
    expect(notificationsTrigger().getAttribute("aria-label")).toBe("Notifications, 2 unread");
    await click(notificationsTrigger());
    await click(button("User creation ready to reviewFictional Acme Salesforce user draft"));
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(workflowNotification.destination);
    expect(notificationsTrigger().getAttribute("aria-label")).toBe("Notifications, 1 unread");
    await click(notificationsTrigger());
    await click(button("Dismiss Salesforce CLI is missing"));
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(notificationsTrigger().getAttribute("aria-label")).toBe("Notifications");
    await click(notificationsTrigger());
    expect(container.querySelectorAll(".hf-inbox-item")).toHaveLength(1);
    expect(container.querySelector(".hf-inbox-item")?.classList.contains("read")).toBe(true);
    await cancelDialog();
    const nextRevision = { ...workflowNotification, id: "workflow:workflow_saved_001:2:prepared" };
    await render([nextRevision, cliNotification]);
    expect(notificationsTrigger().getAttribute("aria-label")).toBe("Notifications, 1 unread");
    await click(notificationsTrigger());
    expect(container.querySelector(".hf-inbox-item")?.classList.contains("unread")).toBe(true);
    expect(localStorage.getItem("headful.notifications.v1")).not.toContain(
      workflowNotification.description,
    );
    expect(localStorage.getItem("headful.notifications.v1")).not.toContain("org_production_001");
  });

  it("keeps the last loaded activity visible and reports a failed refresh", async () => {
    const dispatch = vi.fn(async (operation: string) => {
      if (operation === "listWorkflows") return workflowResponse;
      if (operation === "activity.list") return activityResponse;
      throw new Error(`Unexpected operation ${operation}`);
    });
    const refreshShell = vi.fn(async () => {});
    await act(async () =>
      root.render(
        <InboxProbe ready reviewedEnabled dispatch={dispatch} refreshShell={refreshShell} />,
      ),
    );
    expect(container.querySelector('[aria-label="Loaded activity"]')?.textContent).toBe("41");
    dispatch.mockRejectedValueOnce(new Error("Read failed"));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.querySelector('[aria-label="Loaded activity"]')?.textContent).toBe("41");
    expect(container.querySelector('[aria-label="Inbox error"]')?.textContent).toContain(
      "Showing the last loaded local activity",
    );
    expect(container.querySelector('[aria-label="Inbox loading"]')?.textContent).toBe("false");
  });

  it("clears reviewed history when disabled and ignores a late refresh from the previous feature state", async () => {
    const workflows = deferred<typeof workflowResponse>();
    const activity = deferred<typeof activityResponse>();
    let pending = false;
    const dispatch = vi.fn(async (operation: string) => {
      if (operation === "listWorkflows") return pending ? workflows.promise : workflowResponse;
      if (operation === "activity.list") return pending ? activity.promise : activityResponse;
      throw new Error(`Unexpected operation ${operation}`);
    });
    const refreshShell = vi.fn(async () => {});
    const render = async (reviewedEnabled: boolean) => {
      await act(async () =>
        root.render(
          <InboxProbe
            ready
            reviewedEnabled={reviewedEnabled}
            dispatch={dispatch}
            refreshShell={refreshShell}
          />,
        ),
      );
    };
    await render(true);
    expect(container.querySelector('[aria-label="Loaded activity"]')?.textContent).toBe("41");
    pending = true;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.querySelector('[aria-label="Inbox loading"]')?.textContent).toBe("true");
    await render(false);
    expect(container.querySelector('[aria-label="Loaded activity"]')?.textContent).toBe("");
    const readsAfterDisable = dispatch.mock.calls.length;
    await act(async () => {
      workflows.resolve(workflowResponse);
      activity.resolve(activityResponse);
    });
    expect(container.querySelector('[aria-label="Loaded activity"]')?.textContent).toBe("");
    expect(container.querySelector('[aria-label="Inbox loading"]')?.textContent).toBe("false");
    expect(dispatch.mock.calls).toHaveLength(readsAfterDisable);
  });

  it("does not read a hidden client and refreshes when the client becomes visible", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const dispatch = vi.fn(async (operation: string) =>
      operation === "listWorkflows" ? workflowResponse : activityResponse,
    );
    const refreshShell = vi.fn(async () => {});
    await act(async () =>
      root.render(
        <InboxProbe ready reviewedEnabled dispatch={dispatch} refreshShell={refreshShell} />,
      ),
    );
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(dispatch).not.toHaveBeenCalled();
    expect(refreshShell).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(dispatch.mock.calls.map(([operation]) => operation)).toEqual([
      "listWorkflows",
      "activity.list",
    ]);
    expect(container.querySelector('[aria-label="Loaded activity"]')?.textContent).toBe("41");
  });
});
