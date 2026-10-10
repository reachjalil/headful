// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import {
  headfulModManifestSchema,
  type HeadfulModManifest,
} from "../../../../../packages/contracts/src/headful-mods.ts";
import { ModError } from "../../../../../packages/mod-sdk/src/schema.ts";
const LIMIT = 64 * 1024 * 1024;
export const hash = (data: string | Uint8Array) =>
  NodeCrypto.createHash("sha256").update(data).digest("hex");
export function nativeExecutablePaths(manifest: HeadfulModManifest): ReadonlySet<string> {
  return new Set(
    manifest.resources
      .filter((resource) => resource.executable)
      .map((resource) => resource.path.replace(/^\.\//, "")),
  );
}
export function containedPath(path: string, executables: ReadonlySet<string> = new Set()): string {
  if (
    path.length > 240 ||
    !/^[A-Za-z0-9_./-]+$/.test(path) ||
    path.startsWith("/") ||
    path.split("/").some((x) => !x || x === "." || x === "..") ||
    (!/\.(?:js|mjs|cjs|json|html|css|txt|md|svg|png|ico|icns|zip|woff2?|headfulmod)$/.test(path) &&
      !/(?:^|\/)(?:LICENSE|NOTICE)$/.test(path) &&
      !executables.has(path))
  )
    throw new ModError("artifact_path", "Use contained files of an allowed type: " + path);
  if (/\.(?:map|tsx?)$/.test(path) && !path.endsWith(".d.ts"))
    throw new ModError("artifact_source", "Implementation source and source maps are excluded.");
  return path;
}
export type ModArtifact = {
  format: "headfulmod-1";
  manifest: HeadfulModManifest;
  files: { path: string; size: number; sha256: string; data: string }[];
};
export function compatible(range: string, version: string): boolean {
  const required = range.replace(/^\^/, "").split(".").map(Number),
    current = version.split(".").map(Number);
  if (!range.startsWith("^")) return version === range;
  if (
    required[0] === 0 ? current[0] !== 0 || current[1] !== required[1] : current[0] !== required[0]
  )
    return false;
  for (let i = 0; i < 3; i++) {
    if (current[i]! > required[i]!) return true;
    if (current[i]! < required[i]!) return false;
  }
  return true;
}
export function validateArtifact(data: Uint8Array): { artifact: ModArtifact; revision: string } {
  if (data.byteLength > LIMIT) throw new ModError("artifact_limit", "Artifact exceeds 64 MiB.");
  const value = JSON.parse(Buffer.from(data).toString("utf8"));
  if (
    !value ||
    value.format !== "headfulmod-1" ||
    Object.keys(value).some((k) => !["format", "manifest", "files"].includes(k)) ||
    !Array.isArray(value.files) ||
    value.files.length > 2048
  )
    throw new ModError("artifact_invalid", "Expected a bounded headfulmod-1 archive.");
  const manifest = headfulModManifestSchema.parse(value.manifest);
  const executables = nativeExecutablePaths(manifest);
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(manifest.id))
    throw new ModError("mod_identity", "Mod ids must be namespaced, for example org.example.mod.");
  if (!compatible(manifest.hostApi, "1.0.0") || manifest.apiVersion !== 1)
    throw new ModError("host_incompatible", "Mod requires an incompatible host API.");
  const seen = new Set<string>();
  let total = 0;
  for (const file of value.files) {
    if (
      !file ||
      Object.keys(file).some((k) => !["path", "size", "sha256", "data"].includes(k)) ||
      typeof file.path !== "string" ||
      typeof file.data !== "string" ||
      !Number.isInteger(file.size) ||
      file.size < 0 ||
      file.size > 8 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)
    )
      throw new ModError("artifact_file", "Invalid file inventory.");
    containedPath(file.path, executables);
    const canonical = file.path.normalize("NFC").toLowerCase();
    if (
      seen.has(canonical) ||
      [...seen].some((p) => canonical.startsWith(p + "/") || p.startsWith(canonical + "/"))
    )
      throw new ModError("artifact_collision", "Duplicate, case or file/directory collision.");
    seen.add(canonical);
    const bytes = Buffer.from(file.data, "base64");
    if (
      executables.has(file.path) &&
      (bytes.length < 32 ||
        ![
          "feedface",
          "cefaedfe",
          "feedfacf",
          "cffaedfe",
          "cafebabe",
          "bebafeca",
          "cafebabf",
          "bfbafeca",
        ].includes(bytes.subarray(0, 4).toString("hex")))
    )
      throw new ModError(
        "artifact_executable",
        "Declared native helpers must be Mac Mach-O executables.",
      );
    total += bytes.length;
    if (total > 40 * 1024 * 1024 || bytes.length !== file.size || hash(bytes) !== file.sha256)
      throw new ModError(
        "artifact_integrity",
        "File size, digest or extraction limit failed: " + file.path,
      );
    if (
      /\.(?:js|mjs|cjs|html|css|json)$/.test(file.path) &&
      /sourceMappingURL\s*=\s*(?:data:|[^\s"`';}{]+\.map)|"sourcesContent"\s*:|\/Users\/|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:refresh_token|access_token)\s*["']?\s*[:=]\s*["'][A-Za-z0-9._-]{20,}/.test(
        bytes.toString("utf8"),
      )
    )
      throw new ModError(
        "artifact_source",
        "Embedded source map, local source path or secret in " + file.path,
      );
  }
  if (!seen.has("license") || !seen.has("third_party_notices.md"))
    throw new ModError("artifact_notices", "Include LICENSE and THIRD_PARTY_NOTICES.md.");
  for (const path of [
    ...Object.values(manifest.entryPoints),
    ...manifest.resources.map((x) => x.path),
    ...manifest.contributions.skills.map((x) => x.path),
  ])
    if (path && !seen.has(containedPath(path.replace(/^\.\//, ""), executables).toLowerCase()))
      throw new ModError("artifact_resource", "Declared resource is missing: " + path);
  if (manifest.execution === "community" && !manifest.entryPoints.renderer)
    throw new ModError("artifact_entry", "Community mods require a compiled renderer entry.");
  return {
    artifact: { format: "headfulmod-1", manifest, files: value.files },
    revision: hash(data),
  };
}
export function validateComposition(manifests: HeadfulModManifest[]): void {
  const ids = new Map(manifests.map((m) => [m.id, m]));
  if (ids.size !== manifests.length) throw new ModError("mod_conflict", "Duplicate mod id.");
  const operations = new Set<string>(),
    routes = new Set<string>();
  let transports = 0;
  const visit = (id: string, path = new Set<string>()) => {
    if (path.has(id)) throw new ModError("dependency_cycle", "Mod dependencies contain a cycle.");
    const m = ids.get(id)!;
    for (const dependency of m.dependencies) {
      const d = ids.get(dependency.id);
      if (!d) {
        if (dependency.optional) continue;
        throw new ModError("dependency_missing", dependency.id);
      }
      if (!compatible(dependency.version, d.version))
        throw new ModError("dependency_incompatible", dependency.id);
      visit(d.id, new Set([...path, id]));
    }
  };
  for (const m of manifests) {
    visit(m.id);
    for (const c of m.contributions.desktopOperations) {
      if (operations.has(c.id)) throw new ModError("contribution_conflict", c.id);
      operations.add(c.id);
    }
    for (const r of m.contributions.routes) {
      if (routes.has(r.path)) throw new ModError("contribution_conflict", r.path);
      routes.add(r.path);
    }
    transports += m.contributions.mcp.length;
  }
  if (transports > 1)
    throw new ModError("transport_conflict", "One controlled MCP router is permitted.");
}
export async function packMod(directory: string, destination: string): Promise<string> {
  const manifest = headfulModManifestSchema.parse(
    JSON.parse(await NodeFSP.readFile(NodePath.join(directory, "headful.mod.json"), "utf8")),
  );
  const executables = nativeExecutablePaths(manifest);
  const files: ModArtifact["files"] = [];
  const walk = async (relative: string) => {
    if (relative.endsWith(".d.ts") || relative.startsWith("dist/types/")) return;
    const full = NodePath.join(directory, relative),
      info = await NodeFSP.lstat(full);
    if (info.isSymbolicLink()) throw new ModError("artifact_symlink", "Symlinks cannot be packed.");
    if (info.isDirectory()) {
      for (const name of (await NodeFSP.readdir(full)).sort()) await walk(relative + "/" + name);
    } else {
      containedPath(relative, executables);
      const data = await NodeFSP.readFile(full);
      files.push({
        path: relative,
        size: data.length,
        sha256: hash(data),
        data: data.toString("base64"),
      });
    }
  };
  for (const item of ["dist", "LICENSE", "THIRD_PARTY_NOTICES.md"]) await walk(item);
  for (const item of ["NOTICE", "LICENSES"]) {
    if (await NodeFSP.lstat(NodePath.join(directory, item)).catch(() => null)) await walk(item);
  }
  const data = Buffer.from(JSON.stringify({ format: "headfulmod-1", manifest, files }));
  const { revision } = validateArtifact(data);
  await NodeFSP.mkdir(NodePath.resolve(destination, ".."), { recursive: true });
  await NodeFSP.writeFile(destination, data, { mode: 0o600 });
  return revision;
}
export async function stageArtifact(
  data: Uint8Array,
  root: string,
): Promise<{ directory: string; manifest: HeadfulModManifest; revision: string }> {
  const { artifact, revision } = validateArtifact(data);
  const executables = nativeExecutablePaths(artifact.manifest);
  const stage = NodePath.join(root, ".stage-" + NodeCrypto.randomUUID()),
    destination = NodePath.join(root, artifact.manifest.id, revision);
  await NodeFSP.mkdir(stage, { recursive: true, mode: 0o700 });
  try {
    for (const file of artifact.files) {
      const path = NodePath.join(stage, file.path);
      await NodeFSP.mkdir(NodePath.resolve(path, ".."), { recursive: true, mode: 0o700 });
      await NodeFSP.writeFile(path, Buffer.from(file.data, "base64"), {
        mode: executables.has(file.path) ? 0o700 : 0o600,
        flag: "wx",
      });
    }
    await NodeFSP.writeFile(NodePath.join(stage, "artifact.headfulmod"), data, { mode: 0o600 });
    await NodeFSP.writeFile(
      NodePath.join(stage, "headful.mod.json"),
      JSON.stringify(artifact.manifest),
    );
    await NodeFSP.writeFile(
      NodePath.join(stage, "integrity.json"),
      JSON.stringify({ revision, files: artifact.files.map(({ data, ...f }) => f) }),
    );
    await NodeFSP.writeFile(NodePath.join(stage, "package.json"), '{"type":"module"}');
    await NodeFSP.mkdir(NodePath.resolve(destination, ".."), { recursive: true });
    if (await NodeFSP.lstat(destination).catch(() => null))
      await NodeFSP.rm(stage, { recursive: true });
    else await NodeFSP.rename(stage, destination);
    return { directory: destination, manifest: artifact.manifest, revision };
  } catch (error) {
    await NodeFSP.rm(stage, { recursive: true, force: true });
    throw error;
  }
}
