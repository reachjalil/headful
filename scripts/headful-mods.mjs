#!/usr/bin/env node
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { packMod, validateArtifact } from "../apps/server/src/headful/mods/ModArtifact.ts";
const root = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const [mode, input, output] = process.argv.slice(2);
if (mode === "pack" && input && output)
  console.log(await packMod(NodePath.resolve(input), NodePath.resolve(output)));
else if (mode === "inspect" && input) {
  const { artifact, revision } = validateArtifact(await NodeFSP.readFile(NodePath.resolve(input)));
  console.log(JSON.stringify({ manifest: artifact.manifest, revision }, null, 2));
} else if (mode === "public-build") {
  const directory = NodePath.join(root, "artifacts/mods"),
    file = "headful.admin-utilities.headfulmod";
  await NodeFSP.mkdir(directory, { recursive: true });
  const revision = await packMod(
    NodePath.join(root, "packages/headful-admin-utilities"),
    NodePath.join(directory, file),
  );
  const { artifact } = validateArtifact(await NodeFSP.readFile(NodePath.join(directory, file)));
  await NodeFSP.writeFile(
    NodePath.join(directory, "composition.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        mods: [{ file, revision, native: true, permissions: artifact.manifest.permissions }],
      },
      null,
      2,
    ),
  );
  console.log("Public mod artifact built: " + revision);
} else
  throw new Error(
    "Use headful:mods pack <compiled mod directory> <artifact>, inspect <artifact>, or public-build. Install artifacts in Headful Settings → Mods.",
  );
