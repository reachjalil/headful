import { z } from "zod";
import type { HeadfulAuthority, HeadfulInput, HeadfulOperation, HeadfulResult } from "./headful.ts";
import { utilityOperationPolicies, type HeadfulUtilityOperation } from "./headful-utilities.ts";

export const headfulExtensionApiVersion = 1;
export const extensionIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const extensionFeatureIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?$/)
  .max(128);
const version = z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/);
const componentId = extensionIdSchema;
export const extensionContributionIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/)
  .max(128);
const commandId = z.union([componentId, extensionContributionIdSchema]);
const contributionFeatures = z.array(extensionFeatureIdSchema).max(20).default([]);
const contributionWorkspaces = z.array(extensionContributionIdSchema).max(30).default([]);
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
export const extensionComponentSchema = z.strictObject({
  id: extensionContributionIdSchema,
  kind: z.enum(["panel", "header-control"]),
});
export const extensionNavigationSchema = z.strictObject({
  id: extensionContributionIdSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  componentId: extensionContributionIdSchema,
  icon: contributionIcon.default("cloud"),
  order: z.number().int().min(0).max(1000).default(100),
  requiresOrg: z.boolean().default(true),
  requiredFeatures: contributionFeatures,
});
export const extensionHeaderControlSchema = z.strictObject({
  id: extensionContributionIdSchema,
  name: z.string().min(1).max(100),
  componentId: extensionContributionIdSchema,
  placement: z.enum(["primary", "secondary", "overflow"]).default("primary"),
  defaultVisible: z.boolean().default(true),
  order: z.number().int().min(0).max(1000).default(100),
  workspaceIds: contributionWorkspaces,
  requiredFeatures: contributionFeatures,
});
export const extensionPanelSchema = z.strictObject({
  id: extensionContributionIdSchema,
  name: z.string().min(1).max(100),
  componentId: extensionContributionIdSchema,
  workspaceIds: contributionWorkspaces,
  requiredFeatures: contributionFeatures,
});
export const extensionActionSchema = z.strictObject({
  id: extensionContributionIdSchema,
  name: z.string().min(1).max(100),
  commandId: extensionContributionIdSchema,
  icon: contributionIcon.default("external-link"),
  placement: z.enum(["primary", "overflow"]).default("overflow"),
  order: z.number().int().min(0).max(1000).default(100),
  workspaceIds: contributionWorkspaces,
  requiresOrg: z.boolean().default(true),
  requiredFeatures: contributionFeatures,
});
const relativePath = z
  .string()
  .max(500)
  .refine(
    (path) =>
      path.startsWith("./") &&
      !path.split("/").some((part) => part === ".." || part === "") &&
      !/[\\\u0000-\u001f]/.test(path),
    "Use a contained ./ path.",
  );
export const extensionSettingValueSchema = z.union([
  z.string().max(2000),
  z.number().finite(),
  z.boolean(),
]);
export const extensionSettingsSchema = z.record(extensionIdSchema, extensionSettingValueSchema);
export const extensionCommandResultSchema = z.strictObject({
  message: z.string().max(10000),
  values: extensionSettingsSchema.optional(),
});
export const extensionSurfaceResultSchema = z.strictObject({
  title: z.string().min(1).max(200),
  markdown: z.string().max(30000),
});
export const extensionFeatureSchema = z.strictObject({
  id: extensionFeatureIdSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  availability: z.enum(["available", "experimental"]).default("available"),
  defaultEnabled: z.boolean().default(false),
  dependencies: z.array(extensionFeatureIdSchema).max(30).default([]),
  configuration: z.array(z.string().max(200)).max(20).default([]),
  permissions: z.array(z.string().max(100)).max(20).default([]),
  route: z.string().max(100),
  lifecycle: z.string().max(100).default("on-demand"),
});
export const headfulExtensionManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    apiVersion: z.number().int().positive(),
    id: extensionIdSchema,
    name: z.string().min(1).max(100),
    description: z.string().max(1000),
    version,
    packageName: z
      .string()
      .regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/)
      .max(150),
    license: z.string().min(1).max(100),
    source: z.literal("bundled"),
    sourceClassification: z.enum(["open-source", "proprietary"]).default("open-source"),
    entryPoints: z
      .strictObject({
        server: relativePath.default("./dist/index.js"),
        electronMain: relativePath.optional(),
        renderer: relativePath.optional(),
        mobile: relativePath.optional(),
        worker: relativePath.optional(),
      })
      .default({ server: "./dist/index.js" }),
    defaultEnabled: z.boolean().default(false),
    dependencies: z
      .array(z.strictObject({ id: extensionIdSchema, version: version.optional() }))
      .max(30)
      .default([]),
    requiredFeatures: z.array(extensionFeatureIdSchema).max(30).default([]),
    permissions: z
      .array(
        z.enum([
          "salesforce:read",
          "salesforce:propose",
          "salesforce:records",
          "salesforce:query",
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
        ]),
      )
      .max(20)
      .default([]),
    settings: z
      .array(
        z.strictObject({
          key: extensionIdSchema,
          label: z.string().min(1).max(100),
          type: z.enum(["boolean", "string", "number"]),
          defaultValue: extensionSettingValueSchema,
        }),
      )
      .max(30)
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
              id: extensionContributionIdSchema,
              operations: z.array(z.string().min(1).max(100)).min(1).max(100),
            }),
          )
          .max(30)
          .default([]),
        events: z
          .array(z.enum(["org-policy-changed", "default-org-changed", "feature-changed"]))
          .max(3)
          .default([]),
        features: z.array(extensionFeatureSchema).max(30).default([]),
        components: z.array(extensionComponentSchema).max(100).default([]),
        navigation: z.array(extensionNavigationSchema).max(50).default([]),
        headerControls: z.array(extensionHeaderControlSchema).max(50).default([]),
        panels: z.array(extensionPanelSchema).max(50).default([]),
        actions: z.array(extensionActionSchema).max(50).default([]),
        routes: z
          .array(
            z.strictObject({
              id: componentId,
              name: z.string().min(1).max(100),
              path: z
                .string()
                .regex(/^\/extensions\/[a-z0-9/-]+$/)
                .max(200),
              surfaceId: componentId.optional(),
              requiredFeatures: z.array(extensionFeatureIdSchema).max(20).default([]),
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
              requiredFeatures: z.array(extensionFeatureIdSchema).max(20).default([]),
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
              requiredFeatures: z.array(extensionFeatureIdSchema).max(20).default([]),
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
              parameters: z
                .array(
                  z.strictObject({
                    key: extensionIdSchema,
                    type: z.enum(["boolean", "string", "number"]),
                    required: z.boolean().default(false),
                    label: z.string().max(100).optional(),
                    description: z.string().max(500).optional(),
                    secret: z.boolean().default(false),
                  }),
                )
                .max(30)
                .default([]),
              requiredFeatures: z.array(extensionFeatureIdSchema).max(20).default([]),
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
              requiredFeatures: z.array(extensionFeatureIdSchema).max(20).default([]),
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
          message: "Extension contribution identifiers must be unique.",
          path: [...path],
        });
    };
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
    for (const key of ["components", "navigation", "headerControls", "panels", "actions"] as const)
      for (const [index, contribution] of manifest.contributions[key].entries())
        if (!contribution.id.startsWith(`${manifest.id}/`))
          issue("Native contributions must use their extension namespace.", [
            "contributions",
            key,
            index,
            "id",
          ]);
    for (const [index, command] of manifest.contributions.commands.entries())
      if (command.id.includes("/") && !command.id.startsWith(`${manifest.id}/`))
        issue("Commands must use their extension namespace.", [
          "contributions",
          "commands",
          index,
          "id",
        ]);
    for (const key of ["navigation", "panels", "headerControls"] as const)
      for (const [index, contribution] of manifest.contributions[key].entries()) {
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
        issue("Capabilities use their extension namespace.", ["contributions", "capabilities"]);
    for (const [index, action] of manifest.contributions.actions.entries())
      if (!manifest.contributions.commands.some((command) => command.id === action.commandId))
        issue("A contributed action must reference a declared command.", [
          "contributions",
          "actions",
          index,
          "commandId",
        ]);
  });
export type HeadfulExtensionManifest = z.output<typeof headfulExtensionManifestSchema>;
export const extensionStatusValueSchema = z.strictObject({
  id: componentId,
  label: z.string().max(200),
  state: z.enum(["unconfigured", "connecting", "online", "offline", "error", "idle"]),
  clientCount: z.number().int().min(0).max(100).optional(),
  targetOrgIds: z.array(z.string().max(100)).max(100).default([]),
});
export type HeadfulExtensionStatus = z.output<typeof extensionStatusValueSchema>;
export type HeadfulExtensionEvent =
  | { type: "org-policy-changed"; orgId: string }
  | { type: "default-org-changed"; orgId: string | null }
  | { type: "feature-changed"; id: string; enabled: boolean };
export const headfulExtensionDescriptorSchema = z.strictObject({
  manifest: headfulExtensionManifestSchema,
  enabled: z.boolean(),
  status: z.enum([
    "disabled",
    "inactive",
    "activating",
    "active",
    "incompatible",
    "blocked",
    "error",
  ]),
  compatible: z.boolean(),
  runtimeStatuses: z.array(extensionStatusValueSchema).max(20).default([]),
  registeredCapabilities: z.array(extensionContributionIdSchema).max(30).default([]),
  error: z.strictObject({ code: z.string().max(100), message: z.string().max(500) }).optional(),
});
export const headfulExtensionsSchema = z.strictObject({
  apiVersion: z.literal(1),
  extensions: z.array(headfulExtensionDescriptorSchema).max(100),
});
export type HeadfulExtensionDescriptor = z.output<typeof headfulExtensionDescriptorSchema>;
export interface HeadfulResolvedContribution<T> {
  extensionId: string;
  contribution: T;
  available: boolean;
  unavailableReason: string | null;
}
/** Shared native clients resolve the same declarations and current lifecycle.
 * This is presentation data; the runtime still authorizes every invocation. */
export function resolveHeadfulContributions(
  extensions: readonly HeadfulExtensionDescriptor[],
  features: readonly { id: string; enabled: boolean }[],
) {
  const resolve = <T extends { requiredFeatures: string[] }>(
    extension: HeadfulExtensionDescriptor,
    contribution: T,
  ): HeadfulResolvedContribution<T> => {
    const unavailableFeature = contribution.requiredFeatures.find(
      (id) => !features.some((feature) => feature.id === id && feature.enabled),
    );
    const unavailableReason =
      extension.status !== "active"
        ? `${extension.manifest.name} is ${extension.status}.`
        : unavailableFeature
          ? `Enable ${unavailableFeature} in Headful settings.`
          : null;
    return {
      extensionId: extension.manifest.id,
      contribution,
      available: unavailableReason === null,
      unavailableReason,
    };
  };
  const order = <T extends { order: number }>(
    first: HeadfulResolvedContribution<T>,
    second: HeadfulResolvedContribution<T>,
  ) => first.contribution.order - second.contribution.order;
  return {
    navigation: extensions
      .flatMap((extension) =>
        extension.manifest.contributions.navigation.map((item) => resolve(extension, item)),
      )
      .sort(order),
    headerControls: extensions
      .flatMap((extension) =>
        extension.manifest.contributions.headerControls.map((item) => resolve(extension, item)),
      )
      .sort(order),
    panels: extensions.flatMap((extension) =>
      extension.manifest.contributions.panels.map((item) => resolve(extension, item)),
    ),
    actions: extensions
      .flatMap((extension) =>
        extension.manifest.contributions.actions.map((item) => resolve(extension, item)),
      )
      .sort(order),
    routes: extensions.flatMap((extension) =>
      extension.manifest.contributions.routes.map((item) => resolve(extension, item)),
    ),
    menuBar: extensions
      .flatMap((extension) =>
        extension.manifest.contributions.menuBar.map((item) => resolve(extension, item)),
      )
      .sort(order),
    commands: extensions.flatMap((extension) =>
      extension.manifest.contributions.commands.map((item) => resolve(extension, item)),
    ),
  };
}
export const headfulExtensionInputSchemas = {
  "extensions.list": z.strictObject({}),
  "extensions.inspect": z.strictObject({ id: extensionIdSchema }),
  "extensions.enable": z.strictObject({ id: extensionIdSchema }),
  "extensions.disable": z.strictObject({ id: extensionIdSchema }),
  "extensions.settings": z.strictObject({ id: extensionIdSchema }),
  "extensions.settings.set": z.strictObject({
    id: extensionIdSchema,
    values: extensionSettingsSchema,
  }),
  "extensions.command": z.strictObject({
    id: extensionIdSchema,
    command: commandId,
    input: extensionSettingsSchema.default({}),
  }),
  "extensions.surface": z.strictObject({ id: extensionIdSchema, surfaceId: componentId }),
} as const;
export const headfulExtensionResultSchemas = {
  "extensions.list": headfulExtensionsSchema,
  "extensions.inspect": headfulExtensionDescriptorSchema,
  "extensions.enable": headfulExtensionDescriptorSchema,
  "extensions.disable": headfulExtensionDescriptorSchema,
  "extensions.settings": z.strictObject({ id: extensionIdSchema, values: extensionSettingsSchema }),
  "extensions.settings.set": z.strictObject({
    id: extensionIdSchema,
    values: extensionSettingsSchema,
  }),
  "extensions.command": extensionCommandResultSchema,
  "extensions.surface": extensionSurfaceResultSchema,
} as const;

// An Extension port cannot mint human reviews, mutate org connections or dispatch provider writes.
// Keys originate in the exact public utility policy map, not caller input.
const utilityOperations = Object.keys(utilityOperationPolicies) as HeadfulUtilityOperation[];
export const headfulExtensionOperations = [
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
export type HeadfulExtensionOperation = (typeof headfulExtensionOperations)[number];
export interface HeadfulExtensionPaths {
  homeDir: string;
  profileDir?: string;
  executable?: string;
  bridgeScript?: string;
  runtimeFile?: string;
  assetsDirectory?: string;
  /** Host-resolved compiled entries; never arbitrary renderer supplied paths. */
  extensionPackages?: Readonly<Record<string, string>>;
}
export interface HeadfulExtensionContext {
  readonly extensionId: string;
  readonly signal: AbortSignal;
  readonly paths: Readonly<HeadfulExtensionPaths>;
  readonly runtime: {
    dispatch<K extends HeadfulExtensionOperation>(
      operation: K,
      input: HeadfulInput<K>,
      authority: HeadfulAuthority,
    ): Promise<HeadfulResult<K>>;
  };
  readonly status: { publish(value: z.input<typeof extensionStatusValueSchema>): void };
  readonly events: {
    subscribe(listener: (event: HeadfulExtensionEvent) => void | Promise<void>): () => void;
  };
  readonly capabilities: { register(id: string): HeadfulExtensionContext["runtime"] };
  readonly settings: {
    get(): Record<string, z.output<typeof extensionSettingValueSchema>>;
    set(values: Record<string, z.output<typeof extensionSettingValueSchema>>): void;
  };
  requireActive(): void;
  requireFeature(id: string): void;
}
export interface HeadfulExtensionActivation {
  dispose(): void | Promise<void>;
  handleMcp?(request: Request): Promise<Response>;
  dispatchDesktopIntegration?(operation: string, input: unknown): Promise<unknown>;
  onFeatureChange?(event: { id: string; enabled: boolean }): void | Promise<void>;
  dispatchCommand?(
    command: string,
    input: Record<string, z.output<typeof extensionSettingValueSchema>>,
  ): Promise<z.output<typeof extensionCommandResultSchema>>;
  renderSurface?(surfaceId: string): Promise<z.output<typeof extensionSurfaceResultSchema>>;
}
/** Bundled extensions run as trusted native code. These ports narrow application
 * authority; they are not a sandbox for arbitrary npm code. The host registers
 * reviewed package exports, never a URL, model-selected module or shell command. */
export interface HeadfulExtensionDefinition {
  readonly manifest: z.input<typeof headfulExtensionManifestSchema>;
  /** Added by the trusted loader after metadata validation. */
  readonly compiledEntryPath?: string;
  activate(context: HeadfulExtensionContext): Promise<HeadfulExtensionActivation>;
  recover?(context: HeadfulExtensionContext, operation: string, input: unknown): Promise<unknown>;
}
