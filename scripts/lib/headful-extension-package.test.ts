// @effect-diagnostics nodeBuiltinImport:off
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { resolveHeadfulExtensionPackages } from "./headful-extension-package.ts";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "headful-extensions-"));
  roots.push(root);
  const directory = join(root, "apps/server/node_modules/@headfulcloud/fixture-utilities");
  mkdirSync(join(directory, "dist"), { recursive: true });
  writeFileSync(join(root, "apps/server/package.json"), "{}");
  writeFileSync(
    join(root, "headful.extensions.json"),
    JSON.stringify({
      schemaVersion: 1,
      extensions: [
        { packageName: "@headfulcloud/fixture-utilities" },
        { packageName: "@headfulcloud/fixture-private", optional: true },
      ],
    }),
  );
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({
      name: "@headfulcloud/fixture-utilities",
      version: "0.1.0",
      main: "./dist/index.js",
      dependencies: {},
      exports: { "./package.json": "./package.json", "./manifest": "./headful.extension.json" },
    }),
  );
  writeFileSync(
    join(directory, "headful.extension.json"),
    JSON.stringify({ packageName: "@headfulcloud/fixture-utilities" }),
  );
  writeFileSync(join(directory, "dist/index.js"), "export default {};");
  return { root, directory };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("public compiled package resolves with the private package absent", () => {
  const { root } = fixture();
  expect(resolveHeadfulExtensionPackages(root).map((entry) => entry.packageName)).toEqual([
    "@headfulcloud/fixture-utilities",
  ]);
});
test("missing required packages fail rather than silently removing utilities", () => {
  const { root, directory } = fixture();
  rmSync(directory, { recursive: true });
  expect(() => resolveHeadfulExtensionPackages(root)).toThrow("Missing required extension");
});
test("source maps and symlinks cannot cross the compiled distribution boundary", () => {
  const { root, directory } = fixture();
  writeFileSync(join(directory, "dist/index.js.map"), "{}");
  expect(() => resolveHeadfulExtensionPackages(root)).toThrow("source or an unsupported artifact");
  rmSync(join(directory, "dist/index.js.map"));
  symlinkSync(join(directory, "package.json"), join(directory, "dist/source-link"));
  expect(() => resolveHeadfulExtensionPackages(root)).toThrow("symlinks");
});
test("present optional packages with invalid manifests fail closed", () => {
  const { root } = fixture();
  const directory = join(root, "apps/server/node_modules/@headfulcloud/fixture-private");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ name: "@headfulcloud/fixture-private", main: "./src/index.ts" }),
  );
  expect(() => resolveHeadfulExtensionPackages(root)).toThrow("self-contained compiled extension");
});
