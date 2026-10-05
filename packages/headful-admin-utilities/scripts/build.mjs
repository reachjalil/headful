import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist");
await mkdir(output, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/index.ts"],
  outfile: path.join(output, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  metafile: true,
});
for (const item of Object.values(result.metafile.outputs))
  if (item.imports.some((dependency) => !dependency.path.startsWith("node:")))
    throw new Error("Admin Utilities must bundle its complete server dependency graph.");
const module = await import(pathToFileURL(path.join(output, "index.js")).href);
if (module.default.manifest.id !== "admin-utilities")
  throw new Error("Invalid utility extension identity.");
await writeFile(
  path.join(output, "index.d.ts"),
  'import type { HeadfulExtensionDefinition, HeadfulExtensionManifest } from "@t3tools/contracts/headful-extensions";\nexport declare const manifest: HeadfulExtensionManifest;\ndeclare const definition: HeadfulExtensionDefinition;\nexport default definition;\n',
);
const licenses = path.join(output, "licenses");
await mkdir(licenses, { recursive: true });
const apache = path.resolve(root, "../../LICENSES/Headful-Cloud-Apache-2.0.txt");
await copyFile(apache, path.join(licenses, "Headful-Cloud-Apache-2.0.txt"));
const zodLicense = path.join(root, "node_modules/zod/LICENSE");
await copyFile(zodLicense, path.join(licenses, "zod-MIT.txt"));
await writeFile(
  path.join(root, "THIRD_PARTY_NOTICES.md"),
  "# Admin Utilities third-party notices\n\nThe bundled public portable schemas retain the Apache-2.0 notices from Headful Cloud. Zod retains its MIT license. Complete license texts are distributed in dist/licenses. The utility extension source is independently MIT-licensed.\n\n" +
    (await readFile(zodLicense, "utf8")),
);
console.log(
  "Admin Utilities: self-contained server module, typed entry and license notices built.",
);
