// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import { describe, it, expect, afterEach } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  validateArtifact,
  validateComposition,
  stageArtifact,
} from "../../apps/server/src/headful/mods/ModArtifact.ts";
import { ModRepository } from "../../apps/server/src/headful/InstalledMods.ts";
import { CommunityExecution } from "../../apps/server/src/headful/mods/CommunityExecution.ts";
import { serializable } from "../../packages/mod-sdk/src/schema.ts";
const folders: string[] = [];
afterEach(async () => {
  for (const p of folders.splice(0)) await NodeFSP.rm(p, { recursive: true, force: true });
});
const example = async () =>
  await NodeFSP.readFile(
    new URL("../../artifacts/mods/org.example.hello.headfulmod", import.meta.url),
  );
const mutate = async (work: (a: any) => void) => {
  const a = JSON.parse((await example()).toString());
  work(a);
  return Buffer.from(JSON.stringify(a));
};
describe("local mod containers and atomic installation", () => {
  it("bounds UTF-8 messages by bytes rather than JavaScript string length", () => {
    expect(serializable("é".repeat(100_000))).toBe("é".repeat(100_000));
    expect(() => serializable("é".repeat(140_000))).toThrow("256 KiB");
  });
  it("validates independent community artifacts and immutable extraction", async () => {
    const data = await example(),
      { artifact, revision } = validateArtifact(data);
    expect(artifact.manifest.execution).toBe("community");
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "headful-mod-artifact-"));
    folders.push(dir);
    const staged = await stageArtifact(data, dir);
    expect(staged.revision).toBe(revision);
    expect(
      await NodeFSP.readFile(NodePath.join(staged.directory, "dist/index.js"), "utf8"),
    ).toContain("activateHeadfulMod");
  });
  it.each([
    "../escape.js",
    "/absolute.js",
    "dist/../../escape.js",
    "dist\\evil.js",
    "dist/private.ts",
    "dist/unicode-é.js",
  ])("rejects unsafe archive path %s", async (path) => {
    const data = await mutate((a) => (a.files[0].path = path));
    expect(() => validateArtifact(data)).toThrow();
  });
  it("rejects collisions, symlink metadata, digest changes, incompatible APIs and malformed schemas", async () => {
    for (const change of [
      (a: any) => a.files.push({ ...a.files[0], path: a.files[0].path.toUpperCase() }),
      (a: any) => (a.files[0].type = "symlink"),
      (a: any) => (a.files[0].sha256 = "0".repeat(64)),
      (a: any) => (a.manifest.hostApi = "^2.0.0"),
      (a: any) => (a.manifest.apis[0].input = { type: "arbitrary" }),
    ]) {
      const bytes = await mutate(change);
      expect(() => validateArtifact(bytes)).toThrow();
    }
  });
  it("rejects cycles, API requirements and contribution conflicts", async () => {
    const m = validateArtifact(await example()).artifact.manifest;
    expect(() =>
      validateComposition([
        { ...m, dependencies: [{ id: m.id, version: "^1.0.0", optional: false }] },
      ]),
    ).toThrow("cycle");
    expect(() => validateComposition([m, m])).toThrow("Duplicate");
  });
  it("preserves the prior installation on a bad update and refuses self-declared native trust", async () => {
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "headful-mod-install-"));
    folders.push(dir);
    const repo = new ModRepository(dir, new CommunityExecution(async () => null));
    await repo.load();
    const path = NodePath.join(dir, "example.headfulmod");
    await NodeFSP.writeFile(path, await example());
    await repo.install(path);
    const before = await NodeFSP.readFile(NodePath.join(dir, "mods/installed.json"), "utf8");
    await NodeFSP.writeFile(path, await mutate((a) => (a.files[0].sha256 = "0".repeat(64))));
    await expect(repo.install(path)).rejects.toThrow();
    expect(await NodeFSP.readFile(NodePath.join(dir, "mods/installed.json"), "utf8")).toBe(before);
    await NodeFSP.writeFile(
      path,
      await mutate((a) => {
        a.manifest.execution = "native";
        a.manifest.contributions.events = [];
      }),
    );
    await expect(repo.install(path)).rejects.toThrow("host");
    expect(await NodeFSP.readFile(NodePath.join(dir, "mods/installed.json"), "utf8")).toBe(before);
  });
});
