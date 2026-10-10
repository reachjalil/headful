// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { DocumentView } from "@headfulcloud/admin-utilities/web";
import { settleHeadful } from "../test-loading";

afterEach(() => vi.unstubAllGlobals());
it("renders tables and math, switches document modes, and keeps embedded content inert", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  // jsdom has no layout. Real code/selection geometry is covered by the Chrome journey.
  const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
  const rangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
  const source =
    "# Admin notes\n\n| Object | Read |\n| --- | --- |\n| Account | Yes |\n\nRate $r = \\frac{24}{80}$.\n\n$$\nx^2 + y^2 = z^2\n$$\n\n<script>window.evil = true</script>\n\n[Open](javascript:alert(1)) ![Remote](https://example.invalid/image.png)\n\n$\\href{https://example.invalid}{external}$";
  try {
    await act(async () => root.render(<DocumentView title="Admin notes" markdown={source} />));
    await settleHeadful(container);
    const preview = container.querySelector<HTMLElement>("article")!;
    expect(preview.querySelectorAll("table tbody tr")).toHaveLength(1);
    expect(preview.querySelectorAll(".katex")).toHaveLength(3);
    expect(preview.querySelectorAll(".katex-mathml math")).toHaveLength(3);
    expect(container.querySelector(".cm-editor")).toBeNull();
    expect(container.querySelector("script, iframe, img, a")).toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="editor-document-split"]')!.click(),
    );
    await settleHeadful(container);
    const editor = container.querySelector<HTMLElement>(
      '[data-testid="editor-document-source-editor"]',
    )!;
    expect(preview.hidden).toBe(false);
    expect(editor.closest<HTMLElement>(".hf-document-source")!.hidden).toBe(false);
    expect(editor.getAttribute("contenteditable")).toBe("false");
    expect(editor.textContent).toContain("\\frac{24}{80}");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="editor-document-source"]')!.click(),
    );
    expect(preview.hidden).toBe(true);
    await act(async () =>
      root.render(<DocumentView title="Admin notes" markdown={"Updated $\\notAFunction{1}$"} />),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="editor-document-preview"]')!
        .click(),
    );
    expect(preview.hidden).toBe(false);
    expect(preview.textContent).toContain("Updated");
    expect(preview.querySelector(".katex-mathml [mathcolor]")?.getAttribute("mathcolor")).toBe(
      "#cc0000",
    );
    expect(preview.textContent).toContain("\\notAFunction");
    expect(container.querySelector("script, iframe, img, a")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    if (rangeRects) Object.defineProperty(Range.prototype, "getClientRects", rangeRects);
    else Reflect.deleteProperty(Range.prototype, "getClientRects");
    if (rangeBounds) Object.defineProperty(Range.prototype, "getBoundingClientRect", rangeBounds);
    else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  }
});
