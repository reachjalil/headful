// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { headfulModDescriptorSchema } from "@t3tools/contracts/headful-mods";
import { ModControls } from "./ModControls";

afterEach(() => vi.unstubAllGlobals());
it("preserves ordinary command drafts after failure while clearing sensitive inputs", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const mod = headfulModDescriptorSchema.parse({
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      id: "org.example.controls",
      name: "Example controls",
      description: "Synthetic command",
      version: "1.0.0",
      license: "MIT",
      source: "development",
      entryPoints: { server: "./dist/index.js" },
      contributions: {
        commands: [
          {
            id: "org.example.controls/check",
            name: "Check",
            description: "Check synthetic input",
            parameters: [
              { key: "target", type: "string", label: "Target" },
              { key: "secret", type: "string", label: "One-use secret", secret: true },
            ],
          },
        ],
      },
    },
    enabled: true,
    compatible: true,
    status: "active",
  });
  const dispatch = vi.fn(async () => {
    throw new Error("Synthetic failure");
  });
  const run = async (work: () => Promise<unknown>) => {
    await work().catch(() => {});
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<ModControls mod={mod} disabled={false} dispatch={dispatch} run={run} />),
    );
    const fields = [...container.querySelectorAll<HTMLInputElement>("input")];
    for (const [index, value] of ["Exact org", "Synthetic secret"].entries()) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          fields[index],
          value,
        );
        fields[index]!.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith("mods.command", {
      id: mod.manifest.id,
      command: "org.example.controls/check",
      input: { target: "Exact org", secret: "Synthetic secret" },
    });
    expect(fields[0]!.value).toBe("Exact org");
    expect(fields[1]!.value).toBe("");
    await act(async () =>
      root.render(
        <ModControls
          mod={{ ...mod, enabled: false }}
          disabled={false}
          dispatch={dispatch}
          run={run}
        />,
      ),
    );
    expect(container.querySelector("details")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
