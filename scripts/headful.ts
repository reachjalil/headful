#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveHeadfulExtensionPackages } from "./lib/headful-extension-package.ts";
const root = fileURLToPath(new URL("..", import.meta.url));
if (process.platform !== "darwin")
  throw new Error(
    "Headful early access development and packaging currently target macOS. Mobile source remains available upstream.",
  );
const mode = process.argv[2];
const env = {
  ...process.env,
  HEADFUL_HOME: resolve(root, ".headful-dev"),
  T3CODE_HOME: resolve(root, ".headful-dev"),
  T3CODE_DISABLE_AUTO_UPDATE: "true",
  T3CODE_POSTHOG_KEY: "",
  T3CODE_TELEMETRY_ENABLED: "false",
  T3CODE_RELAY_URL: "",
  VITE_T3CODE_RELAY_URL: "",
  T3CODE_CLERK_PUBLISHABLE_KEY: "",
  VITE_CLERK_PUBLISHABLE_KEY: "",
};
for (const key of Object.keys(env))
  if (/OTLP.*(?:URL|TOKEN)|POSTHOG_KEY|RELAY.*TOKEN/.test(key)) env[key] = "";
async function run(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
    const stop = () => {
      child.kill("SIGTERM");
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.once("error", reject);
    child.once("exit", (code) => {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      code === 0 ? resolve() : reject(new Error(`Headful ${mode} exited ${code}.`));
    });
  });
}
const pnpm = "pnpm";
if (mode === "setup") {
  await run(pnpm, [
    "--filter",
    "@t3tools/desktop...",
    "--filter",
    "t3...",
    "--filter",
    "@t3tools/scripts",
    "install",
  ]);
}
if (["setup", "dev", "check", "package"].includes(mode ?? "")) {
  await run(pnpm, ["--filter", "@headfulcloud/admin-utilities", "run", "build"]);
}
if (mode === "dev" || mode === "package") {
  const installed = resolveHeadfulExtensionPackages(root).find(
    (extension) => extension.packageName === "@headfulcloud/mcp-apps",
  );
  if (installed) {
    const { getMcpAppsAssets } = await import(pathToFileURL(installed.entry).href);
    const assets = getMcpAppsAssets();
    Object.assign(env, {
      HEADFUL_MCP_BRIDGE: assets.bridgeScript,
      HEADFUL_MCP_ASSETS: assets.assetsDirectory,
    });
  }
}
if (mode === "setup") {
  console.log(
    "Open-source Headful is ready. Optional private Extensions can be linked separately.",
  );
} else if (mode === "dev") {
  await run(process.execPath, ["scripts/build-headful-icons.ts"]);
  await run(pnpm, ["dev:desktop", "--home-dir", env.HEADFUL_HOME]);
} else if (mode === "check") {
  await run(pnpm, ["--filter", "t3", "typecheck"]);
  await run(pnpm, ["--filter", "@t3tools/desktop", "typecheck"]);
  await run(pnpm, ["--filter", "@t3tools/web", "typecheck"]);
} else if (mode === "test") {
  await run(pnpm, [
    "exec",
    "vp",
    "test",
    "run",
    "apps/server/src/headful",
    "apps/desktop/src/headful",
    "apps/web/src/headful",
    "scripts/lib/headful-extension-package.test.ts",
    "packages/headful-admin-utilities",
  ]);
} else if (mode === "package") {
  if (process.arch !== "arm64")
    throw new Error("This initial artifact command is checked on Apple Silicon only.");
  await run(process.execPath, ["scripts/build-headful-icons.ts"]);
  await run(process.execPath, [
    "scripts/build-desktop-artifact.ts",
    "--platform",
    "mac",
    "--arch",
    "arm64",
    "--target",
    "zip",
    "--build-version",
    "0.3.0",
    "--output-dir",
    resolve(root, "artifacts/headful"),
    ...process.argv.slice(3),
  ]);
} else
  throw new Error(
    "Use pnpm headful:setup, headful:dev, headful:check, headful:test, or headful:package.",
  );
