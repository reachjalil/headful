import * as NodeModule from "node:module";
import * as NodeURL from "node:url";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeChildProcess from "node:child_process";
const root = NodeURL.fileURLToPath(new URL("..", import.meta.url)),
  require = NodeModule.createRequire(
    NodePath.join(root, "packages/headful-admin-utilities/package.json"),
  ),
  desktopRequire = NodeModule.createRequire(NodePath.join(root, "apps/desktop/package.json")),
  folder = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "headful-mod-journey-build-"));
try {
  await require("esbuild").build({
    entryPoints: [NodePath.join(root, "scripts/fixtures/mod-electron-journey.ts")],
    outfile: NodePath.join(folder, "main.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    sourcemap: false,
    external: ["electron"],
    nodePaths: [
      NodePath.join(root, "apps/server/node_modules"),
      NodePath.join(root, "apps/desktop/node_modules"),
    ],
  });
  await require("esbuild").build({
    entryPoints: [NodePath.join(root, "apps/desktop/src/mod-preload.ts")],
    outfile: NodePath.join(folder, "preload.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    sourcemap: false,
  });
  await new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      HEADFUL_TEST_MOD: NodePath.join(root, "artifacts/mods/org.example.hello.headfulmod"),
      HEADFUL_TEST_PRELOAD: NodePath.join(folder, "preload.cjs"),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = NodeChildProcess.spawn(
        desktopRequire("electron"),
        [NodePath.join(folder, "main.cjs")],
        {
          env,
          stdio: "inherit",
        },
      ),
      deadline = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("Electron mod journey exceeded 60 seconds."));
      }, 60000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(deadline);
      code === 0 ? resolve() : reject(new Error("Electron mod journey failed: " + code));
    });
  });
} finally {
  await NodeFSP.rm(folder, { recursive: true, force: true });
}
