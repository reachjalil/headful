// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import type { SetupDispatch } from "../setup-service";
import { createLeadFixture } from "./fixtures";
import { LeadReview } from "./LeadReview";

async function render(dispatch: SetupDispatch) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<LeadReview dispatch={dispatch} />));
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

it("reads leads only through typed read operations and opens a detail", async () => {
  const fixture = createLeadFixture("ready");
  const dispatch = vi.fn(fixture) as unknown as SetupDispatch;
  const view = await render(dispatch);
  try {
    const row = view.container.querySelector<HTMLButtonElement>('[data-testid="lead-row-1"]')!;
    await act(async () => row.click());
    expect(
      view.container.querySelector("[data-experience-step]")?.getAttribute("data-experience-step"),
    ).toBe("detail");
    const operations = (dispatch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      ([op]) => op,
    );
    expect(new Set(operations)).toEqual(new Set(["orgs.list", "listLeads", "inspectLead"]));
  } finally {
    await view.unmount();
  }
});

it("shows a recoverable message instead of provider errors when the login expired", async () => {
  const view = await render(createLeadFixture("expired"));
  try {
    const alert = view.container.querySelector('[role="alert"]')?.textContent ?? "";
    expect(alert).toContain("Check its connection in Setup");
    expect(alert).not.toContain("expired");
    expect(view.container.querySelector("table")).toBeNull();
  } finally {
    await view.unmount();
  }
});

it("every lead fixture obeys the runtime result contracts", async () => {
  for (const name of ["ready", "empty"] as const) {
    const dispatch = createLeadFixture(name);
    const { leads } = await dispatch("listLeads", {
      orgId: "fixture_production",
      search: "",
      limit: 25,
      page: 1,
    });
    for (const lead of leads)
      await dispatch("inspectLead", { orgId: "fixture_production", leadId: lead.id });
  }
});
