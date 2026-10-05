// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync, readdirSync, lstatSync } from "node:fs";

/** Development links point to the private package. Packaging copies only its
 * compiled distribution, never the link or its source checkout. */
export function resolveHeadfulExtensionPackage(repoRoot: string) {
  const require = createRequire(join(repoRoot, "apps/server/package.json"));
  let manifestPath: string;
  try {
    manifestPath = require.resolve("@headfulcloud/mcp-apps/package.json");
  } catch {
    throw new Error(
      "Build the adjacent private @headfulcloud/mcp-apps package, then run pnpm headful:setup. See docs/EXTENSIONS.md.",
    );
  }
  const directory = dirname(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.name !== "@headfulcloud/mcp-apps" ||
    !manifest.version ||
    Object.keys(manifest.dependencies ?? {}).length
  )
    throw new Error("Headful expects a self-contained compiled MCP Apps package.");
  const distribution = join(directory, "dist");
  function audit(path: string) {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      const info = lstatSync(full);
      if (info.isSymbolicLink()) throw new Error("Extension distribution cannot contain symlinks.");
      if (info.isDirectory()) audit(full);
      else if (
        !info.isFile() ||
        (/(?:\.map|\.tsx?|\.test\.[^.]+)$/.test(entry) && !entry.endsWith(".d.ts"))
      )
        throw new Error("Extension distribution contains source or an unsupported artifact.");
    }
  }
  audit(distribution);
  if (manifest.main !== "./dist/index.js")
    throw new Error("Extension entry must be compiled dist/index.js.");
  return { directory, manifest, entry: join(directory, "dist/index.js") };
}
