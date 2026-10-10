// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  validateArtifact,
  validateComposition,
  hash,
} from "../../apps/server/src/headful/mods/ModArtifact.ts";
/** Public packaging reads only its own public build output and an explicitly supplied composition. */
export function resolveHeadfulModArtifacts(repoRoot: string) {
  const directories = [
    NodePath.join(repoRoot, "artifacts/mods"),
    ...(process.env.HEADFUL_ASSEMBLY_MODS_DIR
      ? [NodePath.resolve(process.env.HEADFUL_ASSEMBLY_MODS_DIR)]
      : []),
  ];
  const mods = directories.flatMap((directory) => {
    const composition = JSON.parse(
      NodeFS.readFileSync(NodePath.join(directory, "composition.json"), "utf8"),
    );
    if (
      composition.schemaVersion !== 1 ||
      !Array.isArray(composition.mods) ||
      composition.mods.length > 50
    )
      throw new Error("Invalid mod composition.");
    return composition.mods.map(
      (item: { file: string; revision: string; native: boolean; permissions: string[] }) => {
        if (!/^[a-z0-9.-]+\.headfulmod$/.test(item.file))
          throw new Error("Invalid composition filename.");
        const file = NodePath.join(directory, item.file),
          bytes = NodeFS.readFileSync(file),
          { artifact, revision } = validateArtifact(bytes);
        if (
          revision !== item.revision ||
          item.native !== (artifact.manifest.execution === "native") ||
          !Array.isArray(item.permissions) ||
          item.permissions.some(
            (p) =>
              ![
                ...artifact.manifest.permissions,
                ...artifact.manifest.optionalPermissions,
              ].includes(p),
          )
        )
          throw new Error("Composition integrity/trust/permissions mismatch.");
        return {
          file,
          bytes,
          manifest: artifact.manifest,
          revision,
          native: item.native,
          permissions: item.permissions,
        };
      },
    );
  });
  validateComposition(mods.map((m) => m.manifest));
  return mods;
}
