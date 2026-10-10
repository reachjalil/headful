// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { z } from "zod";
import * as Effect from "effect/Effect";
import { HostProcessArchitecture } from "@t3tools/shared/hostProcess";
import {
  headfulModManifestSchema,
  type HeadfulModDefinition,
  type HeadfulModManifest,
} from "../../../../packages/contracts/src/headful-mods.ts";
import { ModError } from "../../../../packages/mod-sdk/src/schema.ts";
import {
  hash,
  stageArtifact,
  validateArtifact,
  validateComposition,
  containedPath,
  nativeExecutablePaths,
} from "./mods/ModArtifact.ts";
import type { CommunityExecution } from "./mods/CommunityExecution.ts";
const compositionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  mods: z
    .array(
      z.strictObject({
        file: z.string().max(240),
        revision: z.string().regex(/^[a-f0-9]{64}$/),
        native: z.boolean(),
        permissions: z.array(z.string().max(100)).max(40),
      }),
    )
    .max(50),
});
type Installed = { id: string; revision: string; directory: string };
/** This class never resolves npm package names or discovers a private sibling. */
export class ModRepository {
  private installed: Installed[] = [];
  private trust = new Map<string, readonly string[]>();
  private bundled: Installed[] = [];
  private retired: Installed[] = [];
  readonly root: string;
  readonly homeDir: string;
  readonly execution: CommunityExecution;
  readonly compositionDirectory: string | undefined;
  readonly architecture: NodeJS.Architecture;
  constructor(
    homeDir: string,
    execution: CommunityExecution,
    compositionDirectory?: string,
    architecture: NodeJS.Architecture = Effect.runSync(HostProcessArchitecture),
  ) {
    this.architecture = architecture;
    this.homeDir = homeDir;
    this.execution = execution;
    this.compositionDirectory = compositionDirectory;
    this.root = NodePath.join(homeDir, "mods");
  }
  async load(): Promise<HeadfulModDefinition[]> {
    await NodeFSP.mkdir(this.root, { recursive: true, mode: 0o700 });
    if (this.compositionDirectory) {
      const composition = compositionSchema.parse(
        JSON.parse(
          await NodeFSP.readFile(
            NodePath.join(this.compositionDirectory, "composition.json"),
            "utf8",
          ),
        ),
      );
      this.bundled = [];
      this.trust.clear();
      for (const item of composition.mods) {
        const filename = containedPath(item.file);
        if (!filename.endsWith(".headfulmod"))
          throw new ModError("composition_file", "Expected a local mod artifact.");
        const bytes = await NodeFSP.readFile(NodePath.join(this.compositionDirectory, filename));
        if (hash(bytes) !== item.revision) throw new ModError("composition_integrity", filename);
        const { artifact } = validateArtifact(bytes);
        if (item.native !== (artifact.manifest.execution === "native"))
          throw new ModError("composition_trust", "Execution mode conflicts with host policy.");
        if (item.native) this.trust.set(item.revision, item.permissions);
        const staged = await stageArtifact(bytes, this.root);
        this.bundled.push({
          id: staged.manifest.id,
          revision: staged.revision,
          directory: staged.directory,
        });
      }
    }
    const saved = await NodeFSP.readFile(NodePath.join(this.root, "installed.json"), "utf8").catch(
      (e) => {
        if (e.code === "ENOENT") return "[]";
        throw e;
      },
    );
    const items = z
      .array(
        z.strictObject({
          id: z
            .string()
            .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/)
            .max(128),
          revision: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .max(100)
      .parse(JSON.parse(saved));
    this.installed = items.map((item) => ({
      ...item,
      directory: NodePath.join(this.root, item.id, item.revision),
    }));
    const entries = [
      ...this.bundled.filter((b) => !this.installed.some((i) => i.id === b.id)),
      ...this.installed,
    ];
    const definitions = await Promise.all(entries.map((e) => this.definition(e)));
    validateComposition(definitions.map((d) => headfulModManifestSchema.parse(d.manifest)));
    return definitions;
  }
  private async definition(entry: Installed): Promise<HeadfulModDefinition> {
    // Recheck every installed file before importing code; fail closed after disk tampering.
    const installedBytes = await NodeFSP.readFile(
      NodePath.join(entry.directory, "artifact.headfulmod"),
    );
    const checked = validateArtifact(installedBytes);
    if (checked.revision !== entry.revision)
      throw new ModError("artifact_integrity", "Installed archive changed.");
    const inventory = JSON.parse(
      await NodeFSP.readFile(NodePath.join(entry.directory, "integrity.json"), "utf8"),
    );
    if (
      inventory.revision !== entry.revision ||
      JSON.stringify(inventory.files) !==
        JSON.stringify(checked.artifact.files.map(({ data, ...file }) => file))
    )
      throw new ModError("artifact_integrity", "Invalid installed inventory.");
    const root = await NodeFSP.realpath(entry.directory);
    const executables = nativeExecutablePaths(checked.artifact.manifest);
    for (const file of inventory.files) {
      const path = NodePath.join(entry.directory, containedPath(file.path, executables)),
        info = await NodeFSP.lstat(path);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        (executables.has(file.path) && (info.mode & 0o777) !== 0o700) ||
        !(await NodeFSP.realpath(path)).startsWith(root + NodePath.sep) ||
        hash(await NodeFSP.readFile(path)) !== file.sha256
      )
        throw new ModError("artifact_integrity", "Installed file changed.");
    }
    const manifest = headfulModManifestSchema.parse(
      JSON.parse(
        await NodeFSP.readFile(NodePath.join(entry.directory, "headful.mod.json"), "utf8"),
      ),
    );
    if (JSON.stringify(manifest) !== JSON.stringify(checked.artifact.manifest))
      throw new ModError("artifact_integrity", "Installed manifest changed.");
    if (
      manifest.id !== entry.id ||
      !manifest.platforms.includes(this.architecture === "arm64" ? "mac-arm64" : "mac-x64")
    )
      throw new ModError("platform_unsupported", "Mod identity or platform is incompatible.");
    if (manifest.execution === "community")
      return this.execution.definition(manifest, entry.revision, entry.directory);
    const permissions = this.trust.get(entry.revision);
    if (!permissions)
      throw new ModError(
        "native_untrusted",
        "Native execution requires a host-approved artifact hash. Ordinary installation cannot grant native trust.",
      );
    const path = NodePath.resolve(entry.directory, manifest.entryPoints.server);
    const load = async () => {
      const module = await import(NodeURL.pathToFileURL(path).href + "?revision=" + entry.revision),
        definition = module.default;
      if (
        !definition ||
        typeof definition.activate !== "function" ||
        JSON.stringify(headfulModManifestSchema.parse(definition.manifest)) !==
          JSON.stringify(manifest)
      )
        throw new ModError(
          "mod_definition",
          "Compiled definition differs from the artifact manifest.",
        );
      return definition as HeadfulModDefinition;
    };
    return {
      manifest,
      compiledEntryPath: path,
      artifactRevision: entry.revision,
      nativeTrusted: true,
      hostPermissions: permissions,
      activate: async (context) => (await load()).activate(context),
      recover: async (context, operation, input) => {
        const definition = await load();
        if (!definition.recover) throw new ModError("recovery_missing", "No recovery handler.");
        return definition.recover(context, operation, input);
      },
    };
  }
  async install(
    filename: string,
    validate?: (definitions: readonly HeadfulModDefinition[]) => unknown,
  ): Promise<HeadfulModDefinition[]> {
    const info = await NodeFSP.lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024)
      throw new ModError("artifact_invalid", "Select a regular bounded artifact.");
    const bytes = await NodeFSP.readFile(filename),
      { artifact, revision } = validateArtifact(bytes);
    if (artifact.manifest.execution === "native" && !this.trust.has(revision))
      throw new ModError("native_untrusted", "This native artifact is not approved by this host.");
    const staged = await stageArtifact(bytes, this.root),
      candidate = { id: staged.manifest.id, revision, directory: staged.directory };
    const next = [...this.installed.filter((x) => x.id !== candidate.id), candidate],
      entries = [...this.bundled.filter((b) => !next.some((i) => i.id === b.id)), ...next];
    const definitions = await Promise.all(entries.map((e) => this.definition(e)));
    validateComposition(definitions.map((d) => headfulModManifestSchema.parse(d.manifest)));
    validate?.(definitions);
    await this.save(next);
    this.retired.push(
      ...this.installed.filter(
        (item) => item.id === candidate.id && item.revision !== candidate.revision,
      ),
    );
    this.installed = next;
    return definitions;
  }
  async uninstall(id: string): Promise<HeadfulModDefinition[]> {
    if (this.bundled.some((x) => x.id === id))
      throw new ModError(
        "mod_bundled",
        "Bundled mods can be disabled; remove them from host composition to uninstall.",
      );
    const next = this.installed.filter((x) => x.id !== id);
    const entries = [...this.bundled.filter((b) => !next.some((i) => i.id === b.id)), ...next];
    const definitions = await Promise.all(entries.map((e) => this.definition(e)));
    validateComposition(definitions.map((d) => headfulModManifestSchema.parse(d.manifest)));
    await this.save(next);
    this.retired.push(...this.installed.filter((item) => item.id === id));
    this.installed = next;
    await this.pruneRetired();
    return this.load();
  }
  /** Call after replaced contexts have stopped. Scoped user data lives outside this root. */
  async pruneRetired(): Promise<void> {
    for (const entry of this.retired) {
      if (![...this.installed, ...this.bundled].some((item) => item.directory === entry.directory))
        await NodeFSP.rm(entry.directory, { recursive: true, force: true });
    }
    this.retired = [];
  }
  private async save(entries: Installed[]) {
    const path = NodePath.join(this.root, "installed.json"),
      temporary = path + ".next";
    await NodeFSP.writeFile(temporary, JSON.stringify(entries.map(({ directory, ...e }) => e)), {
      mode: 0o600,
    });
    await NodeFSP.rename(temporary, path);
  }
}
