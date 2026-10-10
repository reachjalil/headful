import registration from "@headfulcloud/admin-utilities/manifest";
import {
  headfulModManifestSchema,
  resolveHeadfulContributions,
  type HeadfulModDescriptor,
} from "@t3tools/contracts/headful-mods";

// These aliases belong to the design recipes, not the editor's contribution identity.
const fixtureSteps: Readonly<Record<string, string>> = {
  "headful.admin-utilities/backup-recovery": "backup",
  "headful.admin-utilities/schema-explorer": "schema",
  "headful.admin-utilities/soql-workspace": "query",
  "headful.admin-utilities/record-inspector": "record",
  "headful.admin-utilities/diagnostics": "health",
  "headful.admin-utilities/org-shortcuts": "shortcuts",
};
export const adminManifest = headfulModManifestSchema.parse(registration);
export const adminTools = adminManifest.contributions.navigation.map((item) => ({
  id: fixtureSteps[item.componentId ?? ""]!,
  contributionId: item.id,
}));
export function editorStep(id: string, componentId?: string) {
  return fixtureSteps[componentId ?? ""] ?? id;
}

/** Metadata chooses a host-owned slot. It never imports code or grants runtime authority. */
export function resolveEditorContributions(
  mods: readonly HeadfulModDescriptor[],
  features: readonly { id: string; enabled: boolean; configuredEnabled?: boolean }[],
  registeredComponents: Readonly<Record<string, unknown>>,
) {
  const resolved = resolveHeadfulContributions(mods, features);
  const owner = (modId: string) => mods.find((mod) => mod.manifest.id === modId)!;
  return {
    tools: resolved.navigation.map((item) => {
      const mod = owner(item.modId);
      const missingComponent =
        item.contribution.componentId &&
        (mod.manifest.execution !== "native" ||
          !Object.hasOwn(registeredComponents, item.contribution.componentId));
      return {
        ...item,
        available: item.available && !missingComponent,
        unavailableReason: missingComponent
          ? "This component is not registered by this Headful build."
          : item.unavailableReason,
        ownerName: mod.manifest.name,
        revision: mod.artifactRevision,
        key: `${item.modId}:${mod.artifactRevision}:${item.contribution.id}`,
        pinned: mod.manifest.id === adminManifest.id && !!item.contribution.componentId,
      };
    }),
    actions: resolved.actions.map((item) => {
      const mod = owner(item.modId);
      const command = mod.manifest.contributions.commands.find(
        (command) => command.id === item.contribution.commandId,
      )!;
      // The editor can supply only its immutable org context. Other inputs belong in the mod's configuration flow.
      const needsConfiguration = command.parameters.some(
        (parameter) =>
          parameter.key !== "org-id" || parameter.type !== "string" || parameter.secret,
      );
      return {
        ...item,
        command,
        needsConfiguration,
        ownerName: mod.manifest.name,
        revision: mod.artifactRevision,
      };
    }),
  };
}
export type EditorTool = ReturnType<typeof resolveEditorContributions>["tools"][number];
export type EditorAction = ReturnType<typeof resolveEditorContributions>["actions"][number];
