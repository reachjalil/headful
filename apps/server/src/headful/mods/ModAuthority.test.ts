// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import { describe, it, expect, afterEach } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { makeHeadfulRuntime, type HeadfulRuntime } from "../WorkspaceService.ts";
import { ModRepository } from "../InstalledMods.ts";
import { CommunityExecution } from "./CommunityExecution.ts";
import { createModBroker } from "./ModBroker.ts";
import { headfulModManifestSchema } from "../../../../../packages/contracts/src/headful-mods.ts";
import type { HeadfulModContext } from "../../../../../packages/contracts/src/headful-mods.ts";
const desktop = { kind: "desktop" as const };
const folders: string[] = [],
  runtimes: HeadfulRuntime[] = [];
afterEach(async () => {
  for (const r of runtimes.splice(0)) await r.close();
  for (const p of folders.splice(0)) await NodeFSP.rm(p, { recursive: true, force: true });
});
async function setup() {
  const folder = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "headful-mod-authority-"));
  folders.push(folder);
  let runtime: HeadfulRuntime;
  const execution = new CommunityExecution(
      createModBroker(
        () => runtime.store,
        () => runtime.mods,
      ),
    ),
    repo = new ModRepository(folder, execution);
  await repo.load();
  const artifact = NodePath.join(folder, "example.headfulmod");
  await NodeFSP.writeFile(
    artifact,
    await NodeFSP.readFile(
      new URL("../../../../../artifacts/mods/org.example.hello.headfulmod", import.meta.url),
    ),
  );
  const definitions = await repo.install(artifact);
  runtime = makeHeadfulRuntime({ homeDir: folder, mods: definitions });
  runtimes.push(runtime);
  return { runtime, execution, repo, artifact };
}
describe("artifact-bound community authority and lifecycle", () => {
  it("enforces the aggregate UTF-8 storage quota through the actual broker", async () => {
    const c = await setup(),
      id = "org.example.hello",
      revision = c.runtime.mods.inspect(id).artifactRevision;
    await c.runtime.mods.grant(id, revision, ["local:storage", "host:events"]);
    await c.runtime.mods.enable(id);
    const pending = c.runtime.mods.command(id, id + "/hello", {});
    await c.execution.waitForJob();
    const [job] = c.execution.pull().jobs;
    for (let index = 0; index < 5; index++)
      await c.execution.call(job!.context, "storage.set", {
        key: "value" + index,
        value: "é".repeat(100_000),
      });
    await expect(
      c.execution.call(job!.context, "storage.set", {
        key: "overflow",
        value: "é".repeat(100_000),
      }),
    ).rejects.toThrow("quota");
    c.execution.reply(job!.context, job!.id, { message: "Ready", values: { count: 0 } });
    await pending;
  });
  it("requires exact native-reviewed permissions before activation; denies forged identity and unsupported authority", async () => {
    const c = await setup(),
      id = "org.example.hello";
    await c.runtime.mods.enable(id);
    expect(c.runtime.mods.inspect(id).status).toBe("inactive");
    await expect(c.runtime.mods.command(id, id + "/hello", {})).rejects.toThrow("permissions");
    const revision = c.runtime.mods.inspect(id).artifactRevision;
    await expect(
      c.runtime.mods.grant(id, "0".repeat(64), ["local:storage", "host:events"]),
    ).rejects.toThrow("current artifact");
    await c.runtime.mods.grant(id, revision, ["local:storage", "host:events"]);
    const call = c.runtime.mods.command(id, id + "/hello", {});
    await c.execution.waitForJob();
    const jobs = c.execution.pull().jobs;
    expect(jobs.length).toBe(1);
    const context = jobs[0]!.context;
    await expect(
      c.execution.call("00000000-0000-4000-8000-000000000000", "storage.get", { key: "count" }),
    ).rejects.toThrow("Context");
    await expect(
      c.execution.call(context, "host", {
        capability: "salesforce:read",
        operation: "listUsers",
        input: { orgId: "forged" },
      }),
    ).rejects.toThrow("does not expose");
    await expect(
      c.execution.call(context, "storage.set", { key: "../another-mod", value: 1 }),
    ).rejects.toThrow("scoped");
    await c.execution.call(context, "storage.set", { key: "count", value: 1 });
    c.execution.reply(context, jobs[0]!.id, { message: "hello", values: { count: 1 } });
    expect(await call).toEqual({ message: "hello", values: { count: 1 } });
    await expect(
      c.execution.call(context, "api", { id: "headful.salesforce-tools/export", input: {} }),
    ).rejects.toThrow("Permission");
  });
  it("revocation cancels pending calls, withdraws events and rejects late contexts while preserving data", async () => {
    const c = await setup(),
      id = "org.example.hello",
      revision = c.runtime.mods.inspect(id).artifactRevision;
    await c.runtime.mods.grant(id, revision, ["local:storage", "host:events"]);
    await c.runtime.mods.enable(id);
    const pending = c.runtime.mods.command(id, id + "/hello", {});
    const outcome = pending.catch((e) => e);
    await c.execution.waitForJob();
    const jobs = c.execution.pull().jobs,
      context = jobs[0]!.context;
    await c.execution.call(context, "storage.set", { key: "keep", value: "saved" });
    await c.runtime.mods.disable(id);
    expect((await outcome).message).toContain("stopped");
    expect(() => c.execution.reply(context, jobs[0]!.id, { message: "late" })).toThrow();
    await expect(c.execution.call(context, "storage.get", { key: "keep" })).rejects.toThrow();
    await c.runtime.mods.publishEvent({ type: "default-org-changed", orgId: null });
    expect(c.execution.pull().jobs).toEqual([]);
    await c.repo.uninstall(id);
    await expect(
      NodeFSP.readFile(NodePath.join(c.repo.root, id, revision, "artifact.headfulmod")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(c.runtime.store.preference("mod:" + id + ":storage", {})).toEqual({ keep: "saved" });
  });
  it("quarantines failed execution and separately deletes only mod-local data", async () => {
    const c = await setup(),
      id = "org.example.hello",
      revision = c.runtime.mods.inspect(id).artifactRevision;
    await c.runtime.mods.grant(id, revision, ["local:storage", "host:events"]);
    await c.runtime.mods.enable(id);
    const pending = c.runtime.mods.command(id, id + "/hello", {}),
      outcome = pending.catch((e) => e);
    await c.execution.waitForJob();
    const [job] = c.execution.pull().jobs;
    c.execution.reply(job!.context, job!.id, null, "Fixture handler failure");
    expect((await outcome).message).toContain("Fixture handler failure");
    expect(c.runtime.mods.inspect(id).status).toBe("failed");
    expect(c.execution.pull().contexts).toEqual([]);
    c.runtime.store.setPreference("mod:" + id + ":storage", { count: 3 });
    c.runtime.store.setPreference("unrelated-user-state", { keep: true });
    await c.runtime.mods.deleteData(id);
    expect(c.runtime.store.preference("mod:" + id + ":storage", null)).toBeNull();
    expect(c.runtime.store.preference("unrelated-user-state", null)).toEqual({ keep: true });
    expect(c.runtime.mods.inspect(id).status).toBe("disabled");
  });
  it("replaces a context and requires renewed review for expanded permissions", async () => {
    const c = await setup(),
      id = "org.example.hello",
      revision = c.runtime.mods.inspect(id).artifactRevision;
    await c.runtime.mods.grant(id, revision, ["local:storage", "host:events"]);
    await c.runtime.mods.enable(id);
    const pending = c.runtime.mods.command(id, id + "/hello", {}),
      outcome = pending.catch((e) => e);
    await c.execution.waitForJob();
    const [job] = c.execution.pull().jobs;
    const updated = JSON.parse((await NodeFSP.readFile(c.artifact)).toString());
    updated.manifest.version = "1.1.0";
    updated.manifest.permissions.push("local:settings");
    await NodeFSP.writeFile(c.artifact, JSON.stringify(updated));
    const definitions = await c.repo.install(c.artifact, (d) =>
      c.runtime.mods.validateDefinitions(d),
    );
    await c.runtime.mods.replaceDefinitions(definitions);
    await c.repo.pruneRetired();
    await expect(
      NodeFSP.readFile(NodePath.join(c.repo.root, id, revision, "artifact.headfulmod")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect((await outcome).message).toContain("stopped");
    expect(() => c.execution.reply(job!.context, job!.id, { message: "late" })).toThrow();
    expect(c.runtime.mods.inspect(id).grantedPermissions).toEqual([]);
    await expect(c.runtime.mods.command(id, id + "/hello", {})).rejects.toThrow("permissions");
  });
  it("enforces export storage quotas across concurrent native requests", async () => {
    const folder = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "headful-export-quota-"));
    folders.push(folder);
    let context: HeadfulModContext | undefined;
    const manifest = headfulModManifestSchema.parse({
      schemaVersion: 1,
      id: "example.exports",
      name: "Exports",
      description: "Synthetic quota fixture",
      version: "1.0.0",
      hostApi: "^1.0.0",
      apiVersion: 1,
      execution: "native",
      source: "local",
      platforms: ["mac-arm64", "mac-x64"],
      entryPoints: { server: "./dist/index.js" },
      activation: ["command"],
      license: "MIT",
      permissions: ["local:artifacts"],
      contributions: {
        commands: [
          {
            id: "example.exports/activate",
            name: "Activate",
            description: "Activate fixture",
            parameters: [],
          },
        ],
      },
    });
    const runtime = makeHeadfulRuntime({
      homeDir: folder,
      mods: [
        {
          manifest,
          artifactRevision: "1".repeat(64),
          nativeTrusted: true,
          hostPermissions: ["local:artifacts"],
          activate: async (value) => {
            context = value;
            return { dispatchCommand: async () => ({ message: "Ready" }), dispose: async () => {} };
          },
        },
      ],
    });
    runtimes.push(runtime);
    await runtime.mods.grant(manifest.id, "1".repeat(64), ["local:artifacts"]);
    await runtime.mods.enable(manifest.id);
    await runtime.mods.command(manifest.id, "example.exports/activate", {});
    const results = await Promise.allSettled(
      Array.from({ length: 101 }, () =>
        context!.artifacts.save("example.csv", "text/csv", "header\nrow\n"),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(100);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await runtime.mods.replaceDefinitions([
      {
        manifest: { ...manifest, permissions: ["local:artifacts", "local:settings"] },
        nativeTrusted: true,
        artifactRevision: "2".repeat(64),
        hostPermissions: ["local:artifacts", "local:settings"],
        activate: async () => ({
          dispatchCommand: async () => ({ message: "Ready" }),
          dispose: async () => {},
        }),
      },
    ]);
    expect(runtime.mods.inspect(manifest.id).grantedPermissions).toEqual([]);
    await expect(runtime.mods.command(manifest.id, "example.exports/activate", {})).rejects.toThrow(
      "permissions",
    );
    await runtime.mods.disable(manifest.id);
    await expect(context!.artifacts.save("late.csv", "text/csv", "late")).rejects.toMatchObject({
      code: "mod_stopped",
    });
  });
});
