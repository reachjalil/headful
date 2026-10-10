import * as NodeModule from "node:module";
import * as NodeURL from "node:url";
import * as NodePath from "node:path";
import * as NodeFSP from "node:fs/promises";
import * as NodeChildProcess from "node:child_process";
const root = NodeURL.fileURLToPath(new URL("..", import.meta.url)),
  require = NodeModule.createRequire(
    NodePath.resolve(root, "../headful-admin-utilities/package.json"),
  );
await require("esbuild").build({
  entryPoints: [NodePath.resolve(root, "src/index.ts")],
  outfile: NodePath.resolve(root, "dist/index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
});
const compilerRequire = NodeModule.createRequire(
  NodePath.resolve(root, "../../apps/server/package.json"),
);
const compiler = NodePath.resolve(compilerRequire.resolve("typescript/package.json"), "../bin/tsc");
const result = NodeChildProcess.spawnSync(
  process.execPath,
  [compiler, "-p", NodePath.resolve(root, "tsconfig.build.json")],
  {
    stdio: "inherit",
  },
);
if (result.status !== 0) throw new Error("Public SDK declaration build failed.");
await NodeFSP.copyFile(
  NodePath.resolve(root, "../../LICENSE"),
  NodePath.resolve(root, "dist/LICENSE"),
);
