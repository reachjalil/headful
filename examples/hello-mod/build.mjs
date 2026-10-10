import * as NodeModule from "node:module";
import * as NodeURL from "node:url";
import * as NodePath from "node:path";
const root = NodeURL.fileURLToPath(new URL(".", import.meta.url));
const require = NodeModule.createRequire(
  NodePath.resolve(root, "../../packages/headful-admin-utilities/package.json"),
);
await require("esbuild").build({
  entryPoints: [NodePath.resolve(root, "src/index.ts")],
  outfile: NodePath.resolve(root, "dist/index.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
});
