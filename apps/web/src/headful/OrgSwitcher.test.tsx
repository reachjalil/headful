// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { OrgSwitcher, type OrgSwitchOption } from "./OrgSwitcher";

it("distinguishes logins sharing an org and label, and sends unavailable connections to management", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const select = vi.fn();
  const manage = vi.fn();
  const orgs: OrgSwitchOption[] = ["alex", "sam", "inactive"].map((name) => ({
    id: `connection_${name}`,
    label: "Acme Production",
    username: `${name}@acme.example`,
    salesforceOrgId: "00D000000000001",
    environment: "Production",
    available: name !== "inactive",
    reason: name === "inactive" ? "Not enabled in Headful" : "",
  }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <OrgSwitcher
          orgs={orgs}
          selectedId="connection_alex"
          onSelect={select}
          onManage={manage}
        />,
      ),
    );
    expect(container.querySelector("summary")?.getAttribute("aria-label")).toContain(
      "alex@acme.example",
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="workspace-org-connection_sam"]')!
        .click(),
    );
    expect(select).toHaveBeenCalledExactlyOnceWith("connection_sam");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="workspace-org-connection_inactive"]')!
        .click(),
    );
    expect(select).toHaveBeenCalledTimes(1);
    expect(manage).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Not enabled in Headful");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
