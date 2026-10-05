/* Adapted from Headful Cloud (Apache-2.0); see LICENSES/Headful-Cloud-Apache-2.0.txt. */
// Adapted for the public Headful desktop from the original Headful workspace.
import { z } from "zod";
import { identifier, sfId, orgSchema, locationSchema } from "./contract-schema.ts";
import { salesforceV2LeadSchema } from "./inherited/lead-schema.ts";
import { workflowSchema } from "./user-schema.ts";
export const profileSchema = z.strictObject({
  id: identifier,
  label: z.string(),
  email: z.email(),
  scopes: z.array(z.string()).max(10),
  orgIds: z.array(identifier).max(50).nullable(),
});
export const leadDatasetSchema = z.strictObject({
  org: orgSchema,
  leads: z.array(salesforceV2LeadSchema).max(100),
  retrievedAt: z.iso.datetime(),
  authority: z.literal("connected-salesforce-read"),
  limit: z.number().int().min(1).max(100),
  bounded: z.literal(true),
  page: z.number().int().positive().optional(),
  hasMore: z.boolean().optional(),
});
export const leadDetailSchema = z.strictObject({
  org: orgSchema,
  lead: salesforceV2LeadSchema,
  retrievedAt: z.iso.datetime(),
  authority: z.literal("connected-salesforce-read"),
});
export const workspaceSeedSchema = z.strictObject({
  kind: z.literal("workspace"),
  profile: profileSchema,
  orgs: z.array(orgSchema).max(50),
  location: locationSchema,
  workflow: workflowSchema.optional(),
  leads: leadDatasetSchema.optional(),
});
const apiName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/);
export const permissionSetSchema = z.object({
  Id: sfId,
  Name: z.string(),
  Label: z.string(),
  Description: z.string().nullable(),
  IsOwnedByProfile: z.boolean(),
  IsCustom: z.boolean(),
  NamespacePrefix: z.string().nullable(),
  LastModifiedDate: z.string(),
});
export const objectPermissionSchema = z.object({
  Id: sfId,
  ParentId: sfId,
  SobjectType: apiName,
  PermissionsRead: z.boolean(),
  PermissionsCreate: z.boolean(),
  PermissionsEdit: z.boolean(),
  PermissionsDelete: z.boolean(),
  PermissionsViewAllRecords: z.boolean(),
  PermissionsModifyAllRecords: z.boolean(),
  LastModifiedDate: z.string(),
  SystemModstamp: z.string(),
});
export const fieldPermissionSchema = z.object({
  Id: sfId,
  ParentId: sfId,
  SobjectType: apiName,
  Field: z.string(),
  PermissionsRead: z.boolean(),
  PermissionsEdit: z.boolean(),
  LastModifiedDate: z.string(),
  SystemModstamp: z.string(),
});
export const permissionListSchema = z.object({
  totalSize: z.number().int(),
  done: z.boolean(),
  records: z.array(permissionSetSchema).max(200),
});
export const permissionDetailSchema = z.object({
  permissionSet: permissionSetSchema,
  objects: z.array(objectPermissionSchema).max(200),
  fields: z.array(fieldPermissionSchema).max(200),
  bounded: z.literal(true),
  objectLimit: z.literal(200),
  fieldLimit: z.literal(200),
});
const permissionFlags = z.strictObject({
  PermissionsRead: z.boolean(),
  PermissionsCreate: z.boolean(),
  PermissionsEdit: z.boolean(),
  PermissionsDelete: z.boolean(),
  PermissionsViewAllRecords: z.boolean(),
  PermissionsModifyAllRecords: z.boolean(),
});
export const permissionChangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("details"), label: z.string(), description: z.string() }),
  z.strictObject({ kind: z.literal("object"), object: apiName, permissions: permissionFlags }),
  z.strictObject({
    kind: z.literal("field"),
    object: apiName,
    field: apiName,
    permissions: z.strictObject({ PermissionsRead: z.boolean(), PermissionsEdit: z.boolean() }),
  }),
]);
const snapshotSchema = z.union([
  permissionSetSchema,
  objectPermissionSchema,
  fieldPermissionSchema,
  z.null(),
]);
const afterSchema = z.union([
  z.strictObject({ Label: z.string(), Description: z.string().nullable() }),
  permissionFlags,
  z.strictObject({ PermissionsRead: z.boolean(), PermissionsEdit: z.boolean() }),
]);
const permissionResultSchema = z.strictObject({
  recordId: sfId,
  verifiedAt: z.iso.datetime(),
  readback: snapshotSchema,
  provider: z.literal("salesforce"),
  authority: z.literal("provider-receipt-and-readback"),
});
export const permissionProposalSchema = z.object({
  id: identifier,
  digest: z.string(),
  orgId: identifier,
  permissionSetId: sfId,
  change: permissionChangeSchema,
  before: snapshotSchema,
  after: afterSchema,
  result: permissionResultSchema.optional(),
  status: z.string(),
  expiresAt: z.number().int(),
});
export const preparedPermissionSchema = permissionProposalSchema
  .omit({ status: true, result: true })
  .extend({
    orgLabel: z.string(),
    reviewUrl: z.url(),
    authority: z.literal("proposal-only-no-provider-write"),
  });
