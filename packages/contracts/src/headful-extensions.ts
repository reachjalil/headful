import { z } from "zod";
import type { HeadfulAuthority, HeadfulInput, HeadfulOperation, HeadfulResult } from "./headful.ts";

export const headfulExtensionApiVersion = 1;
export const extensionIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const extensionFeatureIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?$/)
  .max(128);
const version = z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/);
const componentId = extensionIdSchema;
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
          "local:settings",
          "local:harness-files",
          "local:mcp-transport",
          "local:mcp-app-resources",
        ]),
      )
      .max(10)
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
        features: z.array(extensionFeatureSchema).max(30).default([]),
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
              id: componentId,
              name: z.string().min(1).max(100),
              description: z.string().max(500),
              parameters: z
                .array(
                  z.strictObject({
                    key: extensionIdSchema,
                    type: z.enum(["boolean", "string", "number"]),
                    required: z.boolean().default(false),
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
        features: [],
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
      "features",
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
  });
export type HeadfulExtensionManifest = z.output<typeof headfulExtensionManifestSchema>;
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
  error: z.strictObject({ code: z.string().max(100), message: z.string().max(500) }).optional(),
});
export const headfulExtensionsSchema = z.strictObject({
  apiVersion: z.literal(1),
  extensions: z.array(headfulExtensionDescriptorSchema).max(100),
});
export type HeadfulExtensionDescriptor = z.output<typeof headfulExtensionDescriptorSchema>;
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
    command: componentId,
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

// A plugin port cannot mint human reviews, mutate org connections or dispatch provider writes.
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
] as const satisfies readonly HeadfulOperation[];
export type HeadfulExtensionOperation = (typeof headfulExtensionOperations)[number];
export interface HeadfulExtensionPaths {
  homeDir: string;
  profileDir?: string;
  executable?: string;
  bridgeScript?: string;
  runtimeFile?: string;
  assetsDirectory?: string;
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
  activate(context: HeadfulExtensionContext): Promise<HeadfulExtensionActivation>;
  recover?(context: HeadfulExtensionContext, operation: string, input: unknown): Promise<unknown>;
}
