import { z } from "zod";
import { identifier, orgSchema, sfId } from "./headful-workspace/contract-schema.ts";
export const utilityApiNameSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/);
export const utilityCellSchema = z.union([
  z.string().max(200000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export const utilityDestinationSchema = z.enum([
  "home",
  "setup",
  "users",
  "permission-sets",
  "object-manager",
  "record",
]);
const query = z.string().trim().min(1).max(20000);
const org = z.strictObject({ orgId: identifier });
const queryId = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
const headerControlId = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*){1,2}$/)
  .max(150);
const layout = z.strictObject({
  order: z.array(headerControlId).max(50),
  hidden: z.array(headerControlId).max(50),
});
export const workspacePreferencesSchema = z.strictObject({
  global: layout,
  overrides: z
    .record(z.string().regex(/^[a-z][a-z0-9/-]{0,100}$/), layout)
    .refine((values) => Object.keys(values).length <= 50, "Use at most 50 workspace overrides."),
});
export const headfulUtilityInputSchemas = {
  "utilities.backup.location": z.strictObject({ orgId: identifier }),
  "utilities.record.get": z.strictObject({
    orgId: identifier,
    object: utilityApiNameSchema,
    recordId: sfId,
  }),
  "utilities.query.run": z.strictObject({
    orgId: identifier,
    requestId: queryId,
    query,
    page: z.number().int().min(1).max(41).default(1),
    pageSize: z.number().int().min(1).max(500).default(50),
  }),
  "utilities.query.cancel": z.strictObject({ orgId: identifier, requestId: queryId }),
  "utilities.objects.list": z.strictObject({
    orgId: identifier,
    category: z.enum(["all", "standard", "custom"]).default("all"),
  }),
  "utilities.objects.describe": z.strictObject({ orgId: identifier, object: utilityApiNameSchema }),
  "utilities.diagnostics": org,
  "utilities.logs.list": org,
  "utilities.logs.get": z.strictObject({ orgId: identifier, logId: sfId }),
  "utilities.org.open": z.strictObject({
    orgId: identifier,
    destination: utilityDestinationSchema,
    recordId: sfId.optional(),
  }),
  "utilities.saved.list": org,
  "utilities.saved.set": z.strictObject({
    orgId: identifier,
    id: identifier.optional(),
    name: z.string().trim().min(1).max(100),
    query,
  }),
  "utilities.saved.remove": z.strictObject({ orgId: identifier, id: identifier }),
  "utilities.history.list": org,
  "utilities.favorites.list": org,
  "utilities.favorites.set": z.strictObject({
    orgId: identifier,
    id: identifier.optional(),
    label: z.string().trim().min(1).max(100),
    destination: utilityDestinationSchema,
    recordId: sfId.optional(),
  }),
  "utilities.favorites.remove": z.strictObject({ orgId: identifier, id: identifier }),
  "preferences.get": z.strictObject({}),
  "preferences.set": z.strictObject({ workspace: workspacePreferencesSchema }),
} as const;
export const utilityFieldSchema = z.strictObject({
  name: utilityApiNameSchema,
  label: z.string().max(300),
  type: z.string().max(100),
  length: z.number().int().nonnegative().nullable(),
  nillable: z.boolean(),
  createable: z.boolean(),
  updateable: z.boolean(),
  calculated: z.boolean(),
  referenceTo: z.array(utilityApiNameSchema).max(100),
  relationshipName: z.string().max(100).nullable(),
  picklistValues: z
    .array(
      z.strictObject({
        label: z.string().max(300),
        value: z.string().max(300),
        active: z.boolean(),
        defaultValue: z.boolean(),
      }),
    )
    .max(1000),
});
export const utilityObjectDescribeSchema = z.strictObject({
  org: orgSchema,
  name: utilityApiNameSchema,
  label: z.string().max(300),
  labelPlural: z.string().max(300),
  keyPrefix: z.string().max(3).nullable(),
  queryable: z.boolean(),
  searchable: z.boolean(),
  custom: z.boolean(),
  fields: z.array(utilityFieldSchema).max(5000),
  childRelationships: z
    .array(
      z.strictObject({
        childSObject: utilityApiNameSchema,
        field: utilityApiNameSchema,
        relationshipName: z.string().max(100).nullable(),
        cascadeDelete: z.boolean(),
      }),
    )
    .max(5000),
  bounded: z.literal(true),
});
export const utilitySavedQuerySchema = z.strictObject({
  id: identifier,
  orgId: identifier,
  name: z.string().min(1).max(100),
  query,
  updatedAt: z.number().int().nonnegative(),
});
export const utilityFavoriteSchema = z.strictObject({
  id: identifier,
  orgId: identifier,
  label: z.string().min(1).max(100),
  destination: utilityDestinationSchema,
  recordId: sfId.optional(),
});
const logSchema = z.strictObject({
  id: sfId,
  startTime: z.string().nullable(),
  operation: z.string().max(500).nullable(),
  status: z.string().max(200).nullable(),
  length: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative().nullable(),
  userId: sfId.nullable(),
});
export const headfulUtilityResultSchemas = {
  "utilities.backup.location": z.strictObject({ url: z.url().refine((value) => { const url = new URL(value); return url.origin === "https://headful.cloud" && url.pathname === "/backup"; }), executor: z.literal("cloud"), cloudAuthorization: z.literal("required") }),
  "utilities.record.get": z.strictObject({
    org: orgSchema,
    object: utilityApiNameSchema,
    recordId: sfId,
    fields: z
      .array(
        z.strictObject({
          name: utilityApiNameSchema,
          label: z.string().max(300),
          type: z.string().max(100),
          value: utilityCellSchema,
        }),
      )
      .max(5000),
    bounded: z.literal(true),
  }),
  "utilities.query.run": z.strictObject({
    org: orgSchema,
    requestId: queryId,
    query,
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    columns: z
      .array(
        z.strictObject({
          name: z.string().max(300),
          label: z.string().max(300),
          type: z.string().max(100),
        }),
      )
      .max(1000),
    records: z.array(z.record(z.string().max(300), utilityCellSchema)).max(500),
    returned: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    bounded: z.literal(true),
    elapsedMs: z.number().int().nonnegative(),
    message: z.string().max(1000).optional(),
  }),
  "utilities.query.cancel": z.strictObject({ requestId: queryId, cancelled: z.boolean() }),
  "utilities.objects.list": z.strictObject({
    org: orgSchema,
    objects: z.array(z.strictObject({ name: utilityApiNameSchema, custom: z.boolean() })).max(5000),
    bounded: z.literal(true),
  }),
  "utilities.objects.describe": utilityObjectDescribeSchema,
  "utilities.diagnostics": z.strictObject({
    org: orgSchema,
    limits: z
      .array(
        z.strictObject({
          name: z.string().max(200),
          max: z.number().nonnegative(),
          remaining: z.number().nonnegative(),
        }),
      )
      .max(500),
    storage: z
      .array(
        z.strictObject({
          name: z.string().max(200),
          max: z.number().nonnegative(),
          remaining: z.number().nonnegative(),
          unit: z.literal("MB"),
        }),
      )
      .max(10),
    jobs: z
      .array(
        z.strictObject({
          id: sfId,
          type: z.string().max(100),
          status: z.string().max(100),
          createdAt: z.string().nullable(),
          completedAt: z.string().nullable(),
          processed: z.number().int().nonnegative(),
          total: z.number().int().nonnegative(),
          errors: z.number().int().nonnegative(),
        }),
      )
      .max(100),
    messages: z.array(z.string().max(1000)).max(10),
    bounded: z.literal(true),
  }),
  "utilities.logs.list": z.strictObject({
    org: orgSchema,
    logs: z.array(logSchema).max(100),
    bounded: z.literal(true),
  }),
  "utilities.logs.get": z.strictObject({
    org: orgSchema,
    logId: sfId,
    body: z.string().max(1000000),
    bounded: z.literal(true),
  }),
  "utilities.org.open": z.strictObject({ opened: z.literal(true) }),
  "utilities.saved.list": z.strictObject({ queries: z.array(utilitySavedQuerySchema).max(100) }),
  "utilities.saved.set": utilitySavedQuerySchema,
  "utilities.saved.remove": z.strictObject({ removed: z.boolean() }),
  "utilities.history.list": z.strictObject({
    history: z
      .array(
        z.strictObject({
          id: queryId,
          orgId: identifier,
          query,
          createdAt: z.number().int().nonnegative(),
          returned: z.number().int().nonnegative(),
          status: z.enum(["success", "cancelled", "error"]),
          elapsedMs: z.number().int().nonnegative(),
        }),
      )
      .max(100),
  }),
  "utilities.favorites.list": z.strictObject({ favorites: z.array(utilityFavoriteSchema).max(50) }),
  "utilities.favorites.set": utilityFavoriteSchema,
  "utilities.favorites.remove": z.strictObject({ removed: z.boolean() }),
  "preferences.get": z.strictObject({ workspace: workspacePreferencesSchema }),
  "preferences.set": z.strictObject({ workspace: workspacePreferencesSchema }),
} as const;
export type HeadfulUtilityOperation = keyof typeof headfulUtilityInputSchemas;
export const utilityOperationPolicies = {
  "utilities.backup.location": { feature: "headful.admin-utilities/backup", permission: "salesforce:org-navigation", scope: "headful:read", desktopOnly: true },
  "utilities.record.get": {
    feature: "admin-utilities/record-inspector",
    permission: "salesforce:records",
    scope: "headful:inspect",
    desktopOnly: false,
  },
  "utilities.query.run": {
    feature: "admin-utilities/soql",
    permission: "salesforce:query",
    scope: "headful:query",
    desktopOnly: false,
  },
  "utilities.query.cancel": {
    feature: "admin-utilities/soql",
    permission: "salesforce:query",
    scope: "headful:query",
    desktopOnly: false,
  },
  "utilities.objects.list": {
    feature: "admin-utilities/schema",
    permission: "salesforce:schema",
    scope: "headful:schema",
    desktopOnly: false,
  },
  "utilities.objects.describe": {
    feature: "admin-utilities/schema",
    permission: "salesforce:schema",
    scope: "headful:schema",
    desktopOnly: false,
  },
  "utilities.diagnostics": {
    feature: "admin-utilities/diagnostics",
    permission: "salesforce:diagnostics",
    scope: "headful:diagnostics",
    desktopOnly: false,
  },
  "utilities.logs.list": {
    feature: "admin-utilities/diagnostics",
    permission: "salesforce:diagnostics",
    scope: "headful:diagnostics",
    desktopOnly: false,
  },
  "utilities.logs.get": {
    feature: "admin-utilities/diagnostics",
    permission: "salesforce:diagnostics",
    scope: "headful:diagnostics",
    desktopOnly: false,
  },
  "utilities.org.open": {
    feature: "admin-utilities/org-shortcuts",
    permission: "salesforce:org-navigation",
    scope: "headful:read",
    desktopOnly: true,
  },
  "utilities.saved.list": {
    feature: "admin-utilities/soql",
    permission: "local:utility-preferences",
    scope: "headful:query",
    desktopOnly: false,
  },
  "utilities.saved.set": {
    feature: "admin-utilities/soql",
    permission: "local:utility-preferences",
    scope: "headful:query",
    desktopOnly: true,
  },
  "utilities.saved.remove": {
    feature: "admin-utilities/soql",
    permission: "local:utility-preferences",
    scope: "headful:query",
    desktopOnly: true,
  },
  "utilities.history.list": {
    feature: "admin-utilities/soql",
    permission: "local:utility-preferences",
    scope: "headful:query",
    desktopOnly: false,
  },
  "utilities.favorites.list": {
    feature: "admin-utilities/org-shortcuts",
    permission: "local:utility-preferences",
    scope: "headful:read",
    desktopOnly: false,
  },
  "utilities.favorites.set": {
    feature: "admin-utilities/org-shortcuts",
    permission: "local:utility-preferences",
    scope: "headful:read",
    desktopOnly: true,
  },
  "utilities.favorites.remove": {
    feature: "admin-utilities/org-shortcuts",
    permission: "local:utility-preferences",
    scope: "headful:read",
    desktopOnly: true,
  },
  "preferences.get": {
    feature: null,
    permission: "local:workspace",
    scope: null,
    desktopOnly: true,
  },
  "preferences.set": {
    feature: null,
    permission: "local:workspace",
    scope: null,
    desktopOnly: true,
  },
} as const satisfies Record<
  HeadfulUtilityOperation,
  { feature: string | null; permission: string; scope: string | null; desktopOnly: boolean }
>;
