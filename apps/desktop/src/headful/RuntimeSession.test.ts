// @effect-diagnostics nodeBuiltinImport:off
import { it, expect } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeTimersPromises from "node:timers/promises";
import { readRuntimeSession } from "./RuntimeSession.ts";

it("waits for delayed startup metadata and stops at the readiness deadline", async () => {
  const folder = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "headful-session-readiness-"),
  );
  try {
    const path = NodePath.join(folder, "session.json");
    const pending = readRuntimeSession(path, 2_000);
    await NodeTimersPromises.setTimeout(25);
    await NodeFSP.writeFile(path, '{"origin":"http://127.0.0.1:1234"}');
    expect(await pending).toBe('{"origin":"http://127.0.0.1:1234"}');
    await expect(
      readRuntimeSession(NodePath.join(folder, "missing.json"), 20),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readRuntimeSession(folder, 2_000)).rejects.toMatchObject({ code: "EISDIR" });
  } finally {
    await NodeFSP.rm(folder, { recursive: true });
  }
});
