// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync, readdirSync, lstatSync } from "node:fs";

export interface HeadfulExtensionRegistration {
  packageName: string;
  optional?: boolean;
}

/** Build registrations are trusted, checked-in inputs, never model supplied. */
export function readHeadfulExtensionRegistrations(
  repoRoot: string,
): HeadfulExtensionRegistration[] {
  const value = JSON.parse(readFileSync(join(repoRoot, "headful.extensions.json"), "utf8"));
  if (
    value?.schemaVersion !== 1 ||
    !Array.isArray(value.extensions) ||
    value.extensions.length > 50
  )
    throw new Error("Invalid Headful extension registry.");
  const seen = new Set<string>();
  for (const registration of value.extensions) {
    if (
      !registration ||
      typeof registration !== "object" ||
      !/^@headfulcloud\/[a-z0-9-]+$/.test(registration.packageName) ||
      (registration.optional !== undefined && typeof registration.optional !== "boolean") ||
      Object.keys(registration).some((key) => !["packageName", "optional"].includes(key)) ||
      seen.has(registration.packageName)
    )
      throw new Error("Invalid Headful extension registration.");
    seen.add(registration.packageName);
  }
  return value.extensions;
}

/** Local packages are audited and copied as compiled snapshots during packaging.
 * Optional private packages are absent from the public dependency graph. */
export function resolveHeadfulExtensionPackages(repoRoot: string) {
  const require = createRequire(join(repoRoot, "apps/server/package.json"));
  return readHeadfulExtensionRegistrations(repoRoot).flatMap((registration) => {
    let manifestPath: string;
    try {
      manifestPath = require.resolve(`${registration.packageName}/package.json`);
    } catch (error) {
      if (
        registration.optional &&
        error instanceof Error &&
        "code" in error &&
        error.code === "MODULE_NOT_FOUND"
      )
        return [];
      throw new Error(
        `Missing required extension ${registration.packageName}. Run pnpm headful:setup.`,
        { cause: error },
      );
    }
    const directory = dirname(manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (
      manifest.name !== registration.packageName ||
      !manifest.version ||
      Object.keys(manifest.dependencies ?? {}).length ||
      manifest.main !== "./dist/index.js"
    )
      throw new Error(`Expected a self-contained compiled extension: ${registration.packageName}.`);
    const extensionManifest = JSON.parse(
      readFileSync(require.resolve(`${registration.packageName}/manifest`), "utf8"),
    );
    if (extensionManifest.packageName !== registration.packageName)
      throw new Error("Extension manifest does not match its registration.");
    const distribution = join(directory, "dist");
    function audit(path: string) {
      for (const entry of readdirSync(path)) {
        const full = join(path, entry);
        const info = lstatSync(full);
        if (info.isSymbolicLink())
          throw new Error("Extension distribution cannot contain symlinks.");
        if (info.isDirectory()) audit(full);
        else if (
          !info.isFile() ||
          (/(?:\.map|\.tsx?|\.test\.[^.]+)$/.test(entry) && !entry.endsWith(".d.ts"))
        )
          throw new Error("Extension distribution contains source or an unsupported artifact.");
      }
    }
    audit(distribution);
    const entry = join(distribution, "index.js");
    if (!lstatSync(entry).isFile())
      throw new Error("Extension entry must be compiled dist/index.js.");
    return [{ directory, manifest, entry, packageName: registration.packageName }];
  });
}
