// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import registrations from "../../../../headful.extensions.json" with { type: "json" };
import {
  headfulExtensionManifestSchema,
  type HeadfulExtensionDefinition,
} from "../../../../packages/contracts/src/headful-extensions.ts";

const registrySchema = z.strictObject({
  schemaVersion: z.literal(1),
  extensions: z
    .array(
      z.strictObject({
        packageName: z.string().regex(/^@headfulcloud\/[a-z0-9-]+$/),
      }),
    )
    .max(50),
});
const definitionSchema = z.custom<HeadfulExtensionDefinition>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "manifest" in value &&
    headfulExtensionManifestSchema.safeParse(value.manifest).success &&
    "activate" in value &&
    typeof value.activate === "function" &&
    (!("recover" in value) || typeof value.recover === "function"),
);

/** The checked-in registration manifest is part of the trusted app build.
 * Package metadata is inspected before any compiled activation code is loaded.
 * No registry downloads, paths, shell commands or model-controlled installs. */
export async function loadInstalledExtensions(): Promise<HeadfulExtensionDefinition[]> {
  const registry = registrySchema.parse(registrations);
  const require = createRequire(import.meta.url);
  const packages = new Set<string>();
  const ids = new Set<string>();
  const definitions: HeadfulExtensionDefinition[] = [];
  for (const registration of registry.extensions) {
    if (packages.has(registration.packageName))
      throw new Error("Duplicate Headful extension registration.");
    packages.add(registration.packageName);
    const manifestFile = require.resolve(`${registration.packageName}/manifest`);
    const manifest = headfulExtensionManifestSchema.parse(
      JSON.parse(await readFile(manifestFile, "utf8")),
    );
    if (manifest.packageName !== registration.packageName || ids.has(manifest.id))
      throw new Error("Headful extension manifest identity does not match its registration.");
    ids.add(manifest.id);
    const module: unknown = await import(registration.packageName);
    if (typeof module !== "object" || module === null || !("default" in module))
      throw new Error("Headful extension must export its activation definition as default.");
    const definition = definitionSchema.parse(module.default);
    if (
      JSON.stringify(headfulExtensionManifestSchema.parse(definition.manifest)) !==
      JSON.stringify(manifest)
    )
      throw new Error("Headful extension code and manifest must declare the same contributions.");
    definitions.push(definition);
  }
  return definitions;
}
