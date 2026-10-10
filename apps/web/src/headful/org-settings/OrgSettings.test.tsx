// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { OrgSettings, expiryLabel, limitUsage, retrieveCommand } from "./OrgSettings";
import { createOrgSettingsFixture } from "./fixtures";
import type { SetupDispatch } from "../setup-service";
import type { HeadfulResult } from "@t3tools/contracts/headful";
import { licenseCapacity, licenseExpiry } from "./Licenses";

afterEach(() => vi.unstubAllGlobals());
async function mount(dispatch: SetupDispatch = createOrgSettingsFixture("ready"), fixture = false) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { orgs } = await dispatch("orgs.list", {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <OrgSettings
        orgs={orgs}
        dispatch={dispatch}
        connections={<p>Shared connections</p>}
        modRecords={fixture ? [] : undefined}
      />,
    ),
  );
  const click = async (testId: string) => {
    await act(async () =>
      container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click(),
    );
  };
  return {
    container,
    click,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it("shows scoped facts, capacity warnings, searchable metadata and environment status", async () => {
  const f = await mount();
  try {
    expect(f.container.textContent).toContain("Enterprise Edition");
    await f.click("org-settings-limits");
    expect(f.container.textContent).toContain("Customer Community Login");
    expect(f.container.textContent).toContain("980");
    await f.click("org-settings-license-permission-set");
    expect(f.container.textContent).toContain("CRM Analytics Plus");
    expect(f.container.textContent).toContain("Disabled");
    await f.click("org-settings-license-package");
    expect(f.container.textContent).toContain("No numeric allowance reported");
    await f.click("org-settings-usage-limits");
    expect(f.container.textContent).toContain("74,280");
    await act(async () =>
      [...f.container.querySelectorAll<HTMLButtonElement>("button")]
        .find((b) => b.textContent?.includes("Needs attention"))!
        .click(),
    );
    expect(f.container.textContent).toContain("DataStorageMB");
    expect(f.container.textContent).not.toContain("DailyBulkApiBatches");
    await f.click("org-settings-metadata");
    await f.click("org-settings-type-customobject");
    expect(f.container.textContent).toContain("Project__c");
    expect(f.container.textContent).toContain("Alex Morgan");
    await f.click("org-settings-environments");
    expect(f.container.textContent).toContain("62%");
    expect(f.container.textContent).toContain("Copy completed");
    expect(f.container.querySelector('[role="alert"]')).toBeNull();
    await f.click("org-settings-connections");
    expect(f.container.textContent).toContain("Shared connections");
  } finally {
    await f.close();
  }
});

it("keeps isolated settings fixtures from reading or mutating real native mods", async () => {
  const nativeDispatch = vi.fn();
  vi.stubGlobal("headfulBridge", { dispatch: nativeDispatch });
  const f = await mount(createOrgSettingsFixture("ready"), true);
  try {
    await f.click("org-settings-mods");
    expect(f.container.textContent).toContain("No mods installed");
    expect(
      f.container.querySelector<HTMLButtonElement>('[data-testid="mods-install"]')?.disabled,
    ).toBe(true);
    await act(async () =>
      [...f.container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Refresh")!
        .click(),
    );
    expect(nativeDispatch).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it("shows a failed read without automatic retry and clears old org data during connection changes", async () => {
  const fixture = createOrgSettingsFixture("ready");
  let resolveOld: ((value: HeadfulResult<"orgs.overview">) => void) | undefined;
  let calls = 0;
  const dispatch = (async (op, input) => {
    if (op === "orgs.limits") {
      calls++;
      throw new Error("private provider error");
    }
    if (op === "orgs.overview" && "orgId" in input && input.orgId === "fixture_production")
      return new Promise<HeadfulResult<"orgs.overview">>((resolve) => {
        resolveOld = resolve;
      });
    return fixture(op, input);
  }) as SetupDispatch;
  const f = await mount(dispatch);
  try {
    await act(async () => {
      const select = f.container.querySelector<HTMLSelectElement>(
        '[data-testid="org-settings-org"]',
      )!;
      select.value = "fixture_scratch_org";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(f.container.textContent).toContain("Expires in");
    const old = await fixture("orgs.overview", { orgId: "fixture_production" });
    await act(async () => resolveOld?.(old));
    expect(f.container.textContent).not.toContain("Enterprise Edition");
    await f.click("org-settings-limits");
    await f.click("org-settings-usage-limits");
    expect(f.container.querySelector('[role="alert"]')?.textContent).toContain("unavailable");
    expect(f.container.textContent).not.toContain("private provider error");
    expect(calls).toBe(1);
  } finally {
    await f.close();
  }
});

it("handles missing dates and zero or inconsistent allocations without false percentages", () => {
  expect(expiryLabel(null)).toContain("not reported");
  expect(expiryLabel("not-a-date")).toContain("not reported");
  expect(expiryLabel("2026-10-07", Date.parse("2026-10-07T18:00:00Z"))).toBe("Expires today");
  expect(expiryLabel("2026-10-06", Date.parse("2026-10-07T18:00:00Z"))).toBe("Expired");
  expect(limitUsage({ max: 0, remaining: 0 })).toBeNull();
  expect(limitUsage({ max: 10, remaining: 12 })).toBe(0);
  expect(licenseCapacity(null, 0)).toEqual({ available: null, over: 0, percent: null });
  expect(licenseCapacity(0, 0)).toEqual({ available: 0, over: 0, percent: null });
  expect(licenseCapacity(5, 7)).toEqual({ available: 0, over: 2, percent: 140 });
  expect(licenseExpiry("2026-10-07", "2026-10-07T18:00:00Z")).toMatchObject({
    expired: false,
    soon: true,
  });
  expect(licenseExpiry("2026-10-06", "2026-10-07T18:00:00Z")).toMatchObject({ expired: true });
  expect(retrieveCommand("a'b@example.com", "ApexClass", "Class$Example")).toBe(
    "sf project retrieve start --metadata 'ApexClass:Class$Example' --target-org 'a'\\''b@example.com' --api-version 67.0",
  );
});

it("explains an unavailable license category while preserving other inventories and exact selected-org scope", async () => {
  const fixture = createOrgSettingsFixture("ready");
  const dispatch = (async (op, input) => {
    const result = await fixture(op, input);
    if (op === "orgs.licenses") {
      const licenses = result as HeadfulResult<"orgs.licenses">;
      return {
        ...licenses,
        monthlyLoginsAvailable: false,
        groups: licenses.groups.map((group) =>
          group.kind === "permission-set"
            ? { ...group, licenses: [], availability: "unavailable" }
            : group,
        ),
      };
    }
    return result;
  }) as SetupDispatch;
  const f = await mount(dispatch);
  try {
    await f.click("org-settings-limits");
    await f.click("org-settings-license-attention");
    expect(f.container.textContent).toContain("Customer Community Login");
    expect(f.container.querySelector(".os-license-list")?.textContent).not.toContain(
      "Salesforce Platform",
    );
    await f.click("org-settings-license-permission-set");
    expect(f.container.textContent).toContain("could not be read");
    expect(f.container.textContent).toContain("Monthly login fields are unavailable");
    await act(async () => {
      const select = f.container.querySelector<HTMLSelectElement>(
        '[data-testid="org-settings-org"]',
      )!;
      select.value = "fixture_scratch_org";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(f.container.textContent).not.toContain("Customer Community Login");
    expect(f.container.querySelector(".os-license-list")?.textContent).toContain("Salesforce");
    expect(f.container.querySelectorAll(".os-license")).toHaveLength(1);
  } finally {
    await f.close();
  }
});
