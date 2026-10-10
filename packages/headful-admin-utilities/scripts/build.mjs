import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeFSP from "node:fs/promises";
import { build } from "esbuild";

const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));
const output = NodePath.join(root, "dist");
await NodeFSP.mkdir(output, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/index.ts"],
  outfile: NodePath.join(output, "index.js"),
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
const module = await import(NodeURL.pathToFileURL(NodePath.join(output, "index.js")).href);
if (module.default.manifest.id !== "headful.admin-utilities")
  throw new Error("Invalid utility mod identity.");
await NodeFSP.writeFile(
  NodePath.join(output, "index.d.ts"),
  'import type { HeadfulModDefinition, HeadfulModManifest } from "@t3tools/contracts/headful-mods";\nexport declare const manifest: HeadfulModManifest;\ndeclare const definition: HeadfulModDefinition;\nexport default definition;\n',
);
const licenses = NodePath.join(output, "licenses");
await NodeFSP.mkdir(licenses, { recursive: true });
const apache = NodePath.resolve(root, "../../LICENSES/Headful-Cloud-Apache-2.0.txt");
await NodeFSP.copyFile(apache, NodePath.join(licenses, "Headful-Cloud-Apache-2.0.txt"));
const zodLicense = NodePath.join(root, "node_modules/zod/LICENSE");
await NodeFSP.copyFile(zodLicense, NodePath.join(licenses, "zod-MIT.txt"));
await NodeFSP.writeFile(
  NodePath.join(root, "THIRD_PARTY_NOTICES.md"),
  "# Admin Utilities third-party notices\n\nThe bundled public portable schemas retain the Apache-2.0 notices from Headful Cloud. Zod retains its MIT license. Complete license texts are distributed in dist/licenses. The utility mod source is independently MIT-licensed.\n\n" +
    (await NodeFSP.readFile(zodLicense, "utf8")),
);
console.log(
  "Admin Utilities: self-contained server module, typed entry and license notices built.",
);
