#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
import * as Effect from "effect/Effect";
import {
  HostProcessPlatform,
  HostProcessArchitecture,
} from "../packages/shared/src/hostProcess.ts";
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import * as NodePath from "node:path";

const root = NodeURL.fileURLToPath(new URL("..", import.meta.url));
if (Effect.runSync(HostProcessPlatform) !== "darwin")
  throw new Error(
    "Headful early access development and packaging currently target macOS. Mobile source remains available upstream.",
  );
const mode = process.argv[2];
const env: NodeJS.ProcessEnv = {
  ...process.env,
  HEADFUL_HOME: NodePath.resolve(root, ".headful-dev"),
  T3CODE_HOME: NodePath.resolve(root, ".headful-dev"),
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
    const child = NodeChildProcess.spawn(command, args, { cwd: root, env, stdio: "inherit" });
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
if (["setup", "dev", "check", "test", "package"].includes(mode ?? "")) {
  await run(pnpm, ["--filter", "@headful/mod-sdk", "run", "build"]);
  await run(pnpm, ["--filter", "@headfulcloud/admin-utilities", "run", "build"]);
}
if (["setup", "dev", "check", "package"].includes(mode ?? "")) {
  await run(process.execPath, ["scripts/headful-mods.mjs", "public-build"]);
  env.HEADFUL_MODS_DIR =
    process.env.HEADFUL_DEVELOPMENT_MODS_DIR || NodePath.resolve(root, "artifacts/mods");
}
if (mode === "setup") {
  console.log("Open-source Headful is ready. Mods use explicit compiled artifacts.");
} else if (mode === "dev") {
  await run(process.execPath, ["scripts/build-headful-icons.ts"]);
  await run(pnpm, ["dev:desktop", "--home-dir", env.HEADFUL_HOME!]);
} else if (mode === "check") {
  await run(pnpm, ["--filter", "t3", "typecheck"]);
  await run(pnpm, ["--filter", "@t3tools/desktop", "typecheck"]);
  await run(pnpm, ["--filter", "@t3tools/web", "typecheck"]);
} else if (mode === "test") {
  // Build the synthetic artifact here so the test command also works in a clean clone.
  await run(process.execPath, ["examples/hello-mod/build.mjs"]);
  await run(process.execPath, [
    "scripts/headful-mods.mjs",
    "pack",
    "examples/hello-mod",
    "artifacts/mods/org.example.hello.headfulmod",
  ]);
  await run(pnpm, [
    "exec",
    "vp",
    "test",
    "run",
    "apps/server/src/headful",
    "apps/desktop/src/headful",
    "apps/web/src/headful",
    "scripts/lib/headful-mod-artifact.test.ts",
    "packages/headful-admin-utilities",
  ]);
} else if (mode === "package") {
  if (Effect.runSync(HostProcessArchitecture) !== "arm64")
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
    NodePath.resolve(root, "artifacts/headful"),
    ...process.argv.slice(3),
  ]);
} else
  throw new Error(
    "Use pnpm headful:setup, headful:dev, headful:check, headful:test, or headful:package.",
  );
