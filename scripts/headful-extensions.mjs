#!/usr/bin/env node
import { readFile, mkdir, lstat, realpath, symlink, unlink } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

// Developer-only linking of a build-registered package. The product never
// accepts filesystem paths or installs extensions from agent input.
const root = fileURLToPath(new URL("..", import.meta.url));
const [mode, input] = process.argv.slice(2);
if (!["link", "unlink"].includes(mode) || !input || process.argv.length !== 4)
  throw new Error("Use pnpm headful:extensions link <compiled-package-directory> (or unlink).");
const directory = await realpath(resolve(input));
const metadata = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
const registry = JSON.parse(await readFile(join(root, "headful.extensions.json"), "utf8"));
if (
  !/^@headfulcloud\/[a-z0-9-]+$/.test(metadata.name) ||
  !registry.extensions.some(
    (registration) => registration.packageName === metadata.name && registration.optional,
  )
)
  throw new Error("Local links are allowed only for registered optional Headful packages.");
const destination = join(root, "apps/server/node_modules", metadata.name);
const existing = await lstat(destination).catch((error) => {
  if (error.code === "ENOENT") return undefined;
  throw error;
});
if (existing && (!existing.isSymbolicLink() || (await realpath(destination)) !== directory))
  throw new Error("Refusing to replace a different installed package. Remove it explicitly first.");
if (mode === "unlink") {
  if (existing) await unlink(destination);
  console.log(`Unlinked ${metadata.name}. Open-source Headful remains available.`);
} else {
  const manifest = JSON.parse(await readFile(join(directory, "headful.extension.json"), "utf8"));
  if (
    metadata.main !== "./dist/index.js" ||
    metadata.exports?.["./manifest"] !== "./headful.extension.json" ||
    manifest.packageName !== metadata.name ||
    Object.keys(metadata.dependencies ?? {}).length ||
    !(await lstat(join(directory, "dist/index.js"))).isFile()
  )
    throw new Error(
      "Build a self-contained compiled extension with matching manifest before linking it.",
    );
  await mkdir(dirname(destination), { recursive: true });
  if (!existing) await symlink(directory, destination, "dir");
  console.log(`Linked ${metadata.name} locally. No npm publication or download performed.`);
}
