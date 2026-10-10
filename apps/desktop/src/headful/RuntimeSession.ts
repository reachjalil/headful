// @effect-diagnostics nodeBuiltinImport:off globalDate:off - bounded native startup readiness.
import * as NodeFSP from "node:fs/promises";
import * as NodeTimersPromises from "node:timers/promises";

/** Wait only for startup metadata. The caller sends its operation exactly once. */
export async function readRuntimeSession(path: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await NodeFSP.readFile(path, "utf8");
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT" ||
        Date.now() >= deadline
      )
        throw error;
      await NodeTimersPromises.setTimeout(Math.min(100, deadline - Date.now()));
    }
  }
}
