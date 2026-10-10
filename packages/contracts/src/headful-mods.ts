import type { HeadfulAgentRunnerPort } from "./headful-agent.ts";
import { validateSchema, type ValueSchema } from "../../mod-sdk/src/schema.ts";
import { z } from "zod";
import type { HeadfulAuthority, HeadfulInput, HeadfulOperation, HeadfulResult } from "./headful.ts";
import { utilityOperationPolicies, type HeadfulUtilityOperation } from "./headful-utilities.ts";

export const headfulModApiVersion = 1;
export const modIdSchema = z.string().regex(/^[a-z][a-z0-9.-]{0,127}$/);
export const modIdentitySchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/)
  .max(128);
export const modFeatureIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9.-]*(?:\/[a-z][a-z0-9-]*)?$/)
  .max(128);
const version = z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/);
const componentId = modIdSchema;
export const modContributionIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9.-]*\/[a-z][a-z0-9-]*$/)
  .max(128);
const commandId = z.union([componentId, modContributionIdSchema]);
const valueSchema = z.custom<import("../../mod-sdk/src/schema.ts").ValueSchema>((value) => {
  try {
    validateSchema(value as ValueSchema);
    return true;
  } catch {
    return false;
  }
}, "Use a bounded supported value schema.");
const contributionFeatures = z.array(modFeatureIdSchema).max(20).default([]);
const contributionWorkspaces = z.array(modContributionIdSchema).max(30).default([]);
const contributionIcon = z.enum([
  "cloud",
  "search",
  "table",
  "database",
  "activity",
  "external-link",
  "star",
  "key",
  "users",
]);
export const modComponentSchema = z.strictObject({
  id: modContributionIdSchema,
  kind: z.enum(["panel", "header-control"]),
});
export const modNavigationSchema = z.strictObject({
  id: modContributionIdSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  componentId: modContributionIdSchema.optional(),
  surfaceId: componentId.optional(),
  icon: contributionIcon.default("cloud"),
  order: z.number().int().min(0).max(1000).default(100),
  requiresOrg: z.boolean().default(true),
  requiredFeatures: contributionFeatures,
});
export const modHeaderControlSchema = z.strictObject({
  id: modContributionIdSchema,
  name: z.string().min(1).max(100),
  componentId: modContributionIdSchema,
  placement: z.enum(["primary", "secondary", "overflow"]).default("primary"),
  defaultVisible: z.boolean().default(true),
  order: z.number().int().min(0).max(1000).default(100),
  workspaceIds: contributionWorkspaces,
  requiredFeatures: contributionFeatures,
});
export const modPanelSchema = z.strictObject({
  id: modContributionIdSchema,
  name: z.string().min(1).max(100),
  componentId: modContributionIdSchema,
  workspaceIds: contributionWorkspaces,
  requiredFeatures: contributionFeatures,
});
export const modActionSchema = z.strictObject({
  id: modContributionIdSchema,
  name: z.string().min(1).max(100),
  commandId: modContributionIdSchema,
  icon: contributionIcon.default("external-link"),
  placement: z.enum(["primary", "overflow"]).default("overflow"),
  order: z.number().int().min(0).max(1000).default(100),
  workspaceIds: contributionWorkspaces,
  requiresOrg: z.boolean().default(true),
  requiredFeatures: contributionFeatures,
});
export const modResourcePathSchema = z
  .string()
  .max(500)
  .refine(
    (path) =>
      path.startsWith("./") &&
      !path.split("/").some((part) => part === ".." || part === "") &&
      !/[\\\u0000-\u001f]/.test(path),
    "Use a contained ./ path.",
  );
const relativePath = modResourcePathSchema;
export const modSettingValueSchema = z.union([
  z.string().max(2000),
  z.number().finite(),
  z.boolean(),
]);
export const modSettingsSchema = z.record(modIdSchema, modSettingValueSchema);
export const modCommandResultSchema = z.strictObject({
  message: z.string().max(10000),
  values: modSettingsSchema.optional(),
});
export const modSurfaceResultSchema = z.strictObject({
  title: z.string().min(1).max(200),
  markdown: z.string().max(30000),
});
export const modFeatureSchema = z.strictObject({
  id: modFeatureIdSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  availability: z.enum(["available", "experimental"]).default("available"),
  defaultEnabled: z.boolean().default(false),
  dependencies: z.array(modFeatureIdSchema).max(30).default([]),
  configuration: z.array(z.string().max(200)).max(20).default([]),
  permissions: z.array(z.string().max(100)).max(20).default([]),
  route: z.string().max(100),
  lifecycle: z.string().max(100).default("on-demand"),
});
export const headfulModManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    apiVersion: z.number().int().positive(),
    hostApi: z
      .string()
      .regex(/^(?:\^)?\d+\.\d+\.\d+$/)
      .default("^1.0.0"),
    platforms: z
      .array(z.enum(["mac-arm64", "mac-x64", "web", "mobile"]))
      .min(1)
      .max(4)
      .default(["mac-arm64", "mac-x64"]),
    execution: z.enum(["community", "native"]).default("community"),
    activation: z
      .array(z.enum(["command", "view", "api", "event", "background"]))
      .max(5)
      .default(["command", "view", "api"]),
    optionalPermissions: z.array(z.string().min(1).max(100)).max(20).default([]),
    resources: z
      .array(
        z.strictObject({
          path: relativePath,
          exposed: z.boolean().default(false),
          executable: z.boolean().optional(),
        }),
      )
      .max(500)
      .default([]),
    distribution: z
      .strictObject({
        author: z.string().min(1).max(100),
        sourceUrl: z.string().url().max(500).optional(),
      })
      .default({ author: "Headful" }),
    id: modIdentitySchema,
    name: z.string().min(1).max(100),
    description: z.string().max(1000),
    version,
    license: z.string().min(1).max(100),
    source: z.enum(["bundled", "local", "development"]),
    sourceClassification: z.enum(["open-source", "proprietary"]).default("open-source"),
    entryPoints: z
      .strictObject({
        server: modResourcePathSchema.default("./dist/index.js"),
        electronMain: relativePath.optional(),
        renderer: relativePath.optional(),
        mobile: relativePath.optional(),
        worker: relativePath.optional(),
      })
      .default({ server: "./dist/index.js" }),
    defaultEnabled: z.boolean().default(false),
    dependencies: z
      .array(
        z.strictObject({
          id: modIdentitySchema,
          version: z.string().regex(/^(?:\^)?\d+\.\d+\.\d+$/),
          optional: z.boolean().default(false),
        }),
      )
      .max(30)
      .default([]),
    requiredFeatures: z.array(modFeatureIdSchema).max(30).default([]),
    permissions: z
      .array(
        z.enum([
          "salesforce:read",
          "salesforce:propose",
          "salesforce:records",
          "salesforce:query",
          "salesforce:stream",
          "salesforce:schema",
          "salesforce:diagnostics",
          "salesforce:org-navigation",
          "local:utility-preferences",
          "local:workspace",
          "local:settings",
          "local:harness-files",
          "local:mcp-transport",
          "local:mcp-app-resources",
          "local:remote-transport",
          "local:folder-access",
          "local:agent-runner",
          "local:storage",
          "local:artifacts",
          "host:events",
          "mods:api",
        ]),
      )
      .max(20)
      .default([]),
    settings: z
      .array(
        z.strictObject({
          key: modIdSchema,
          label: z.string().min(1).max(100),
          type: z.enum(["boolean", "string", "number"]),
          defaultValue: modSettingValueSchema,
        }),
      )
      .max(30)
      .default([]),
    apis: z
      .array(z.strictObject({ id: z.string().max(150), input: valueSchema, output: valueSchema }))
      .max(30)
      .default([]),
    eventSubscriptions: z
      .array(
        z.strictObject({
          type: z.string().max(150),
          schemaVersion: z.literal(1),
          filter: z
            .record(z.string().max(100), z.union([z.string().max(200), z.boolean()]))
            .default({}),
        }),
      )
      .max(20)
      .default([]),
    contributions: z
      .strictObject({
        menuBar: z
          .array(
            z.strictObject({
              id: componentId,
              name: z.string().min(1).max(100),
              commandId: commandId.optional(),
              routeId: componentId.optional(),
              requiredFeatures: contributionFeatures,
              order: z.number().int().min(0).max(1000).default(100),
            }),
          )
          .max(30)
          .default([]),
        statuses: z
          .array(
            z.strictObject({
              id: componentId,
              name: z.string().min(1).max(100),
            }),
          )
          .max(20)
          .default([]),
        capabilities: z
          .array(
            z.strictObject({
              id: modContributionIdSchema,
              operations: z.array(z.string().min(1).max(100)).min(1).max(100),
            }),
          )
          .max(30)
          .default([]),
        events: z
          .array(z.enum(["org-policy-changed", "default-org-changed", "feature-changed"]))
          .max(3)
          .default([]),
        features: z.array(modFeatureSchema).max(30).default([]),
        components: z.array(modComponentSchema).max(100).default([]),
        navigation: z.array(modNavigationSchema).max(50).default([]),
        headerControls: z.array(modHeaderControlSchema).max(50).default([]),
        panels: z.array(modPanelSchema).max(50).default([]),
        actions: z.array(modActionSchema).max(50).default([]),
        routes: z
          .array(
            z.strictObject({
              id: componentId,
              name: z.string().min(1).max(100),
              path: z
                .string()
                .regex(/^\/mods\/[a-z0-9./-]+$/)
                .max(200),
              surfaceId: componentId.optional(),
              requiredFeatures: z.array(modFeatureIdSchema).max(20).default([]),
            }),
          )
          .max(30)
          .default([]),
        skills: z
          .array(
            z.strictObject({
              id: componentId,
              name: z.string().min(1).max(100),
              description: z.string().max(500),
              path: relativePath,
            }),
          )
          .max(50)
          .default([]),
        mcp: z
          .array(
            z.strictObject({
              id: componentId,
              transport: z.literal("streamable-http"),
              path: z.literal("/mcp"),
              requiredFeatures: z.array(modFeatureIdSchema).max(20).default([]),
            }),
          )
          .max(1)
          .default([]),
        harness: z
          .array(
            z.strictObject({
              id: componentId,
              name: z.string().min(1).max(100),
              skills: z.array(componentId).max(50).default([]),
              mcp: z.array(componentId).max(10).default([]),
            }),
          )
          .max(20)
          .default([]),
        hooks: z
          .array(z.enum(["activate", "deactivate", "feature-changed"]))
          .max(3)
          .default([]),
        desktopOperations: z
          .array(
            z.strictObject({
              id: z
                .string()
                .regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/)
                .max(100),
              recovery: z.boolean().default(false),
              requiredFeatures: z.array(modFeatureIdSchema).max(20).default([]),
            }),
          )
          .max(50)
          .default([]),
        commands: z
          .array(
            z.strictObject({
              id: commandId,
              name: z.string().min(1).max(100),
              description: z.string().max(500),
              inputSchema: valueSchema.optional(),
              outputSchema: valueSchema.optional(),
              parameters: z
                .array(
                  z.strictObject({
                    key: modIdSchema,
                    type: z.enum(["boolean", "string", "number"]),
                    required: z.boolean().default(false),
                    label: z.string().max(100).optional(),
                    description: z.string().max(500).optional(),
                    secret: z.boolean().default(false),
                  }),
                )
                .max(30)
                .default([]),
              requiredFeatures: z.array(modFeatureIdSchema).max(20).default([]),
            }),
          )
          .max(30)
          .default([]),
        surfaces: z
          .array(
            z.strictObject({
              id: componentId,
              name: z.string().min(1).max(100),
              description: z.string().max(500),
              requiredFeatures: z.array(modFeatureIdSchema).max(20).default([]),
            }),
          )
          .max(30)
          .default([]),
      })
      .default({
        menuBar: [],
        statuses: [],
        capabilities: [],
        events: [],
        features: [],
        components: [],
        navigation: [],
        headerControls: [],
        panels: [],
        actions: [],
        routes: [],
        skills: [],
        mcp: [],
        harness: [],
        hooks: [],
        desktopOperations: [],
        commands: [],
        surfaces: [],
      }),
  })
  .superRefine((manifest, context) => {
    const unique = (values: readonly string[], path: readonly (string | number)[]) => {
      if (new Set(values).size !== values.length)
        context.addIssue({
          code: "custom",
          message: "Mod contribution identifiers must be unique.",
          path: [...path],
        });
    };
    unique(
      manifest.apis.map((api) => api.id),
      ["apis"],
    );
    unique(
      manifest.eventSubscriptions.map((event) => event.type),
      ["eventSubscriptions"],
    );
    for (const api of manifest.apis)
      if (!api.id.startsWith(manifest.id + "/"))
        context.addIssue({
          code: "custom",
          message: "API ids use the mod namespace.",
          path: ["apis"],
        });
    if (
      manifest.execution === "community" &&
      (manifest.contributions.desktopOperations.length ||
        manifest.contributions.mcp.length ||
        manifest.contributions.features.length ||
        manifest.contributions.capabilities.length ||
        manifest.entryPoints.electronMain ||
        manifest.entryPoints.mobile ||
        manifest.entryPoints.worker)
    )
      context.addIssue({
        code: "custom",
        message: "Community mods use broker contributions only.",
        path: ["contributions"],
      });
    unique(
      manifest.settings.map((setting) => setting.key),
      ["settings"],
    );
    unique(
      manifest.dependencies.map((dependency) => dependency.id),
      ["dependencies"],
    );
    for (const key of [
      "menuBar",
      "statuses",
      "capabilities",
      "features",
      "components",
      "navigation",
      "headerControls",
      "panels",
      "actions",
      "routes",
      "skills",
      "mcp",
      "harness",
      "desktopOperations",
      "commands",
      "surfaces",
    ] as const)
      unique(
        manifest.contributions[key].map((item) => item.id),
        ["contributions", key],
      );
    for (const [index, command] of manifest.contributions.commands.entries())
      unique(
        command.parameters.map((parameter) => parameter.key),
        ["contributions", "commands", index, "parameters"],
      );
    const issue = (message: string, path: (string | number)[]) =>
      context.addIssue({ code: "custom", message, path });
    for (const [index, resource] of manifest.resources.entries())
      if (
        resource.executable &&
        (manifest.execution !== "native" ||
          resource.exposed ||
          !/^\.\/dist\/native\/[a-z][a-z0-9-]{0,79}$/.test(resource.path))
      )
        issue(
          "Executable resources require reviewed native execution, a private dist/native path and no exposure.",
          ["resources", index],
        );
    for (const key of ["components", "navigation", "headerControls", "panels", "actions"] as const)
      for (const [index, contribution] of manifest.contributions[key].entries())
        if (!contribution.id.startsWith(`${manifest.id}/`))
          issue("Native contributions must use their mod namespace.", [
            "contributions",
            key,
            index,
            "id",
          ]);
    for (const [index, command] of manifest.contributions.commands.entries())
      if (command.id.includes("/") && !command.id.startsWith(`${manifest.id}/`))
        issue("Commands must use their mod namespace.", ["contributions", "commands", index, "id"]);
    for (const key of ["navigation", "panels", "headerControls"] as const)
      for (const [index, contribution] of manifest.contributions[key].entries()) {
        if (key === "navigation" && "surfaceId" in contribution && contribution.surfaceId) {
          if (contribution.componentId)
            issue("Navigation references exactly one component or surface.", [
              "contributions",
              key,
              index,
            ]);
          if (
            !manifest.contributions.surfaces.some(
              (surface) => surface.id === contribution.surfaceId,
            )
          )
            issue("Navigation references a missing surface.", [
              "contributions",
              key,
              index,
              "surfaceId",
            ]);
          continue;
        }
        if (key === "navigation" && manifest.execution === "community")
          issue("Community navigation references a declared surface, not a native component.", [
            "contributions",
            key,
            index,
          ]);
        const kind = key === "headerControls" ? "header-control" : "panel";
        if (
          !manifest.contributions.components.some(
            (component) => component.id === contribution.componentId && component.kind === kind,
          )
        )
          issue("A native contribution must reference a declared component of the correct kind.", [
            "contributions",
            key,
            index,
            "componentId",
          ]);
      }
    for (const [index, menu] of manifest.contributions.menuBar.entries()) {
      if ((!menu.commandId && !menu.routeId) || (menu.commandId && menu.routeId))
        issue("Menu items reference exactly one command or route.", [
          "contributions",
          "menuBar",
          index,
        ]);
      if (
        menu.commandId &&
        !manifest.contributions.commands.some((command) => command.id === menu.commandId)
      )
        issue("Menu item references a missing command.", ["contributions", "menuBar", index]);
      if (menu.routeId && !manifest.contributions.routes.some((route) => route.id === menu.routeId))
        issue("Menu item references a missing route.", ["contributions", "menuBar", index]);
    }
    for (const capability of manifest.contributions.capabilities)
      if (!capability.id.startsWith(`${manifest.id}/`))
        issue("Capabilities use their mod namespace.", ["contributions", "capabilities"]);
    for (const [index, action] of manifest.contributions.actions.entries())
      if (!manifest.contributions.commands.some((command) => command.id === action.commandId))
        issue("A contributed action must reference a declared command.", [
          "contributions",
          "actions",
          index,
          "commandId",
        ]);
  });
export type HeadfulModManifest = z.output<typeof headfulModManifestSchema>;
export const modStatusValueSchema = z.strictObject({
  id: componentId,
  label: z.string().max(200),
  state: z.enum(["unconfigured", "connecting", "online", "offline", "error", "idle"]),
  clientCount: z.number().int().min(0).max(100).optional(),
  targetOrgIds: z.array(z.string().max(100)).max(100).default([]),
});
export type HeadfulModStatus = z.output<typeof modStatusValueSchema>;
export type HeadfulModEvent =
  | { type: "org-policy-changed"; orgId: string }
  | { type: "default-org-changed"; orgId: string | null }
  | { type: "feature-changed"; id: string; enabled: boolean };
export const headfulModDescriptorSchema = z.strictObject({
  manifest: headfulModManifestSchema,
  enabled: z.boolean(),
  artifactRevision: z.string().max(100).default("development"),
  grantedPermissions: z.array(z.string().max(100)).max(40).default([]),
  status: z.enum([
    "disabled",
    "inactive",
    "activating",
    "active",
    "incompatible",
    "blocked",
    "failed",
  ]),
  compatible: z.boolean(),
  runtimeStatuses: z.array(modStatusValueSchema).max(20).default([]),
  registeredCapabilities: z.array(modContributionIdSchema).max(30).default([]),
  error: z.strictObject({ code: z.string().max(100), message: z.string().max(500) }).optional(),
});
export const headfulModsSchema = z.strictObject({
  apiVersion: z.literal(1),
  mods: z.array(headfulModDescriptorSchema).max(100),
});
export type HeadfulModDescriptor = z.output<typeof headfulModDescriptorSchema>;
export interface HeadfulResolvedContribution<T> {
  modId: string;
  contribution: T;
  available: boolean;
  unavailableReason: string | null;
}
/** Shared native clients resolve the same declarations and current lifecycle.
 * This is presentation data; the runtime still authorizes every invocation. */
export function resolveHeadfulContributions(
  mods: readonly HeadfulModDescriptor[],
  features: readonly { id: string; enabled: boolean; configuredEnabled?: boolean }[],
) {
  const resolve = <T extends { requiredFeatures: string[] }>(
    mod: HeadfulModDescriptor,
    contribution: T,
    trigger?: "command" | "view" | "api",
    referencedFeatures: readonly string[] = [],
  ): HeadfulResolvedContribution<T> => {
    const unavailableFeature = [
      ...mod.manifest.requiredFeatures,
      ...contribution.requiredFeatures,
      ...referencedFeatures,
    ].find(
      (id) =>
        !features.some(
          (feature) =>
            feature.id === id &&
            (feature.enabled || (mod.status === "inactive" && feature.configuredEnabled === true)),
        ),
    );
    const unavailableReason = !mod.enabled
      ? `${mod.manifest.name} is disabled.`
      : !mod.compatible
        ? `${mod.manifest.name} is incompatible.`
        : mod.manifest.permissions.some(
              (permission) => !mod.grantedPermissions.includes(permission),
            )
          ? `Review ${mod.manifest.name} permissions in Local mods.`
          : mod.status !== "active" &&
              !(mod.status === "inactive" && trigger && mod.manifest.activation.includes(trigger))
            ? `${mod.manifest.name} is ${mod.status}.`
            : trigger && !mod.manifest.activation.includes(trigger)
              ? `${mod.manifest.name} does not declare ${trigger} activation.`
              : unavailableFeature
                ? `Enable ${unavailableFeature} in Headful settings.`
                : null;
    return {
      modId: mod.manifest.id,
      contribution,
      available: unavailableReason === null,
      unavailableReason,
    };
  };
  const order = <T extends { order: number; id: string }>(
    first: HeadfulResolvedContribution<T>,
    second: HeadfulResolvedContribution<T>,
  ) =>
    first.contribution.order - second.contribution.order ||
    first.contribution.id.localeCompare(second.contribution.id);
  return {
    navigation: mods
      .flatMap((mod) =>
        mod.manifest.contributions.navigation.map((item) =>
          resolve(
            mod,
            item,
            item.surfaceId ? "view" : "api",
            mod.manifest.contributions.surfaces.find((surface) => surface.id === item.surfaceId)
              ?.requiredFeatures,
          ),
        ),
      )
      .sort(order),
    headerControls: mods
      .flatMap((mod) => mod.manifest.contributions.headerControls.map((item) => resolve(mod, item)))
      .sort(order),
    panels: mods.flatMap((mod) =>
      mod.manifest.contributions.panels.map((item) => resolve(mod, item)),
    ),
    actions: mods
      .flatMap((mod) =>
        mod.manifest.contributions.actions.map((item) =>
          resolve(
            mod,
            item,
            "command",
            mod.manifest.contributions.commands.find((command) => command.id === item.commandId)
              ?.requiredFeatures,
          ),
        ),
      )
      .sort(order),
    routes: mods.flatMap((mod) =>
      mod.manifest.contributions.routes.map((item) => resolve(mod, item, "view")),
    ),
    menuBar: mods
      .flatMap((mod) =>
        mod.manifest.contributions.menuBar.map((item) =>
          resolve(mod, item, item.commandId ? "command" : "view"),
        ),
      )
      .sort(order),
    commands: mods.flatMap((mod) =>
      mod.manifest.contributions.commands.map((item) => resolve(mod, item, "command")),
    ),
  };
}
export const headfulModInputSchemas = {
  "mods.list": z.strictObject({}),
  "mods.inspect": z.strictObject({ id: modIdentitySchema }),
  "mods.enable": z.strictObject({ id: modIdentitySchema }),
  "mods.disable": z.strictObject({ id: modIdentitySchema }),
  "mods.api": z.strictObject({
    id: modIdentitySchema,
    api: z.string().max(150),
    input: z.unknown(),
  }),
  "mods.settings": z.strictObject({ id: modIdentitySchema }),
  "mods.settings.set": z.strictObject({
    id: modIdentitySchema,
    values: modSettingsSchema,
  }),
  "mods.command": z.strictObject({
    id: modIdentitySchema,
    command: commandId,
    input: modSettingsSchema.default({}),
    artifactRevision: z.string().min(1).max(100).optional(),
  }),
  "mods.surface": z.strictObject({
    id: modIdentitySchema,
    surfaceId: componentId,
    artifactRevision: z.string().min(1).max(100).optional(),
  }),
} as const;
export const headfulModResultSchemas = {
  "mods.list": headfulModsSchema,
  "mods.inspect": headfulModDescriptorSchema,
  "mods.enable": headfulModDescriptorSchema,
  "mods.disable": headfulModDescriptorSchema,
  "mods.api": z.unknown(),
  "mods.settings": z.strictObject({ id: modIdentitySchema, values: modSettingsSchema }),
  "mods.settings.set": z.strictObject({
    id: modIdentitySchema,
    values: modSettingsSchema,
  }),
  "mods.command": modCommandResultSchema,
  "mods.surface": modSurfaceResultSchema,
} as const;

// An Mod port cannot mint human reviews, mutate org connections or dispatch provider writes.
// Keys originate in the exact public utility policy map, not caller input.
const utilityOperations = Object.keys(utilityOperationPolicies) as HeadfulUtilityOperation[];
export const headfulModOperations = [
  "status",
  "listOrgs",
  "orgs.health",
  "orgs.sandboxes",
  "listLeads",
  "inspectLead",
  "listPermissionSets",
  "inspectPermissionSet",
  "preparePermissionChange",
  "getPermissionProposal",
  "listUsers",
  "inspectUser",
  "inspectUserAccess",
  "listWorkflows",
  "prepareUserCreation",
  "getWorkflow",
  "saveUserDraft",
  "reconcileUser",
  "getUserAccess",
  "prepareUserAccess",
  "reconcileAccess",
  ...utilityOperations,
] as const satisfies readonly HeadfulOperation[];
export type HeadfulModOperation = (typeof headfulModOperations)[number];
export interface HeadfulModPaths {
  homeDir: string;
  /** Native provider adapter uses the host-selected CLI; never a renderer input. */
  salesforceCli?: string;
  profileDir?: string;
  executable?: string;
  bridgeScript?: string;
  runtimeFile?: string;
  assetsDirectory?: string;
  /** Host-resolved compiled entries; never arbitrary renderer supplied paths. */
  modPackages?: Readonly<Record<string, string>>;
}
export interface HeadfulModContext {
  readonly modId: string;
  readonly signal: AbortSignal;
  readonly paths: Readonly<HeadfulModPaths>;
  /** Native-only current permission guard; it conveys no provider-write approval. */
  readonly permissions?: { require(permission: string): void };
  readonly runtime: {
    dispatch<K extends HeadfulModOperation>(
      operation: K,
      input: HeadfulInput<K>,
      authority: HeadfulAuthority,
    ): Promise<HeadfulResult<K>>;
  };
  /** Trusted native runner port. Absent in standalone native-runtime fixtures. */
  readonly agentRunner?: HeadfulAgentRunnerPort;
  readonly artifacts: {
    save(
      filename: string,
      mediaType: "text/csv" | "application/json",
      content: string,
    ): Promise<{ handle: string; size: number; sha256: string }>;
  };
  readonly status: { publish(value: z.input<typeof modStatusValueSchema>): void };
  readonly events: {
    subscribe(listener: (event: HeadfulModEvent) => void | Promise<void>): () => void;
  };
  readonly capabilities: { register(id: string): HeadfulModContext["runtime"] };
  readonly settings: {
    get(): Record<string, z.output<typeof modSettingValueSchema>>;
    set(values: Record<string, z.output<typeof modSettingValueSchema>>): void;
  };
  requireActive(): void;
  requireFeature(id: string): void;
}
export interface HeadfulModActivation {
  dispose(): void | Promise<void>;
  startBackground?(): Promise<void>;
  dispatchApi?(api: string, input: unknown): Promise<unknown>;
  handleMcp?(request: Request): Promise<Response>;
  dispatchDesktopIntegration?(operation: string, input: unknown): Promise<unknown>;
  onFeatureChange?(event: { id: string; enabled: boolean }): void | Promise<void>;
  dispatchCommand?(
    command: string,
    input: Record<string, z.output<typeof modSettingValueSchema>>,
  ): Promise<z.output<typeof modCommandResultSchema>>;
  renderSurface?(surfaceId: string): Promise<z.output<typeof modSurfaceResultSchema>>;
}
/** Bundled mods run as trusted native code. These ports narrow application
 * authority; they are not a sandbox for arbitrary npm code. The host registers
 * reviewed package exports, never a URL, model-selected module or shell command. */
export interface HeadfulModDefinition {
  readonly manifest: z.input<typeof headfulModManifestSchema>;
  /** Added by the trusted loader after metadata validation. */
  readonly compiledEntryPath?: string;
  readonly artifactRevision?: string;
  readonly nativeTrusted?: boolean;
  readonly hostPermissions?: readonly string[];
  activate(context: HeadfulModContext): Promise<HeadfulModActivation>;
  recover?(context: HeadfulModContext, operation: string, input: unknown): Promise<unknown>;
}
