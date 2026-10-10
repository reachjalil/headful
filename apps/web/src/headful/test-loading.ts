import { act } from "react";
import { expect, vi } from "vite-plus/test";

/** Tests wait for actual chunk readiness rather than assuming an eager first render. */
export async function settleHeadful(container: HTMLElement) {
  await vi.waitFor(
    async () => {
      await act(async () => {
        await vi.dynamicImportSettled();
      });
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    },
    { timeout: 5000 },
  );
}
