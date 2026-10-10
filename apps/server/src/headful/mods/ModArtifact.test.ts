// @effect-diagnostics nodeBuiltinImport:off
import { afterEach, expect, it } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { packMod, stageArtifact, validateArtifact } from "./ModArtifact.ts";

const owned: string[] = [];
afterEach(async () => {
  for (const directory of owned.splice(0))
    await NodeFSP.rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "headful-native-artifact-"),
  );
  owned.push(directory);
  await NodeFSP.mkdir(NodePath.join(directory, "dist/native"), { recursive: true });
  const manifest = {
    schemaVersion: 1,
    apiVersion: 1,
    execution: "native",
    id: "org.example.native-helper",
    name: "Native helper fixture",
    description: "Packaging fixture",
    version: "1.0.0",
    license: "MIT",
    source: "bundled",
    entryPoints: { server: "./dist/index.js" },
    resources: [{ path: "./dist/native/helper", exposed: false, executable: true }],
  };
  await NodeFSP.writeFile(NodePath.join(directory, "headful.mod.json"), JSON.stringify(manifest));
  await NodeFSP.writeFile(NodePath.join(directory, "dist/index.js"), "export default {};");
  await NodeFSP.writeFile(NodePath.join(directory, "LICENSE"), "Synthetic fixture license");
  await NodeFSP.writeFile(
    NodePath.join(directory, "THIRD_PARTY_NOTICES.md"),
    "Synthetic fixture notices",
  );
  return { directory, manifest, archive: NodePath.join(directory, "fixture.headfulmod") };
}
it("installs an explicitly declared native Mac helper with owner-only executable permission and exact bytes", async () => {
  const f = await fixture();
  await NodeFSP.copyFile("/usr/bin/true", NodePath.join(f.directory, "dist/native/helper"));
  const revision = await packMod(f.directory, f.archive),
    bytes = await NodeFSP.readFile(f.archive);
  expect(validateArtifact(bytes).revision).toBe(revision);
  const installed = await stageArtifact(bytes, NodePath.join(f.directory, "installed"));
  const helper = NodePath.join(installed.directory, "dist/native/helper");
  expect((await NodeFSP.stat(helper)).mode & 0o777).toBe(0o700);
  expect(
    (await NodeFSP.stat(NodePath.join(installed.directory, "dist/index.js"))).mode & 0o777,
  ).toBe(0o600);
  expect(await NodeFSP.readFile(helper)).toEqual(await NodeFSP.readFile("/usr/bin/true"));
  expect(NodeChildProcess.execFileSync(helper)).toEqual(Buffer.alloc(0));
});
it("rejects undeclared helpers, community or exposed executables, scripts and digest substitution", async () => {
  const f = await fixture(),
    helper = NodePath.join(f.directory, "dist/native/helper");
  await NodeFSP.writeFile(helper, "#!/bin/sh\nexit 0\n");
  await expect(packMod(f.directory, f.archive)).rejects.toMatchObject({
    code: "artifact_executable",
  });
  for (const manifest of [
    { ...f.manifest, resources: [] },
    { ...f.manifest, execution: "community" },
    { ...f.manifest, resources: [{ ...f.manifest.resources[0], exposed: true }] },
  ]) {
    await NodeFSP.writeFile(
      NodePath.join(f.directory, "headful.mod.json"),
      JSON.stringify(manifest),
    );
    await expect(packMod(f.directory, f.archive)).rejects.toThrow();
  }
  await NodeFSP.writeFile(
    NodePath.join(f.directory, "headful.mod.json"),
    JSON.stringify(f.manifest),
  );
  const syntheticHeader = Buffer.alloc(32);
  syntheticHeader.writeUInt32BE(0xcffaedfe);
  await NodeFSP.writeFile(helper, syntheticHeader);
  await packMod(f.directory, f.archive);
  const changed = JSON.parse(await NodeFSP.readFile(f.archive, "utf8"));
  const file = changed.files.find((file: { path: string }) => file.path === "dist/native/helper");
  file.data = Buffer.alloc(32, 7).toString("base64");
  expect(() => validateArtifact(Buffer.from(JSON.stringify(changed)))).toThrow();
});
