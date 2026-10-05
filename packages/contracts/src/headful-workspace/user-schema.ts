/* Adapted from Headful Cloud (Apache-2.0); see LICENSES/Headful-Cloud-Apache-2.0.txt. */
// Adapted for the public Headful desktop from the original Headful workspace.
import { z } from "zod";
import { identifier, sfId } from "./contract-schema.ts";
import { connectionBindingSchema } from "./workflow-schema.ts";
export const userDraftSchema = z.strictObject({
  FirstName: z.string().trim().max(40).default(""),
  LastName: z.string().trim().min(1).max(80),
  Email: z.email().max(80),
  Username: z.email().max(80),
  Alias: z.string().trim().min(1).max(8),
  ProfileId: sfId,
  TimeZoneSidKey: z.string().min(1).max(100),
  LocaleSidKey: z.string().min(1).max(100),
  LanguageLocaleKey: z.string().min(1).max(100),
  EmailEncodingKey: z.string().min(1).max(100),
  IsActive: z.boolean().default(true),
  CommunityNickname: z.string().min(1).max(40).optional(),
  CurrencyIsoCode: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  Title: z.string().max(80).optional(),
  Department: z.string().max(80).optional(),
  Phone: z.string().max(40).optional(),
});
export type UserDraft = z.infer<typeof userDraftSchema>;
const picklistSchema = z.object({
  active: z.boolean(),
  defaultValue: z.boolean(),
  label: z.string(),
  value: z.string(),
});
export const describeFieldSchema = z.object({
  name: z.string(),
  label: z.string(),
  type: z.string(),
  length: z.number().int(),
  createable: z.boolean(),
  nillable: z.boolean(),
  defaultedOnCreate: z.boolean(),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  picklistValues: z.array(picklistSchema).max(3000),
});
export const profileSchema = z.object({ Id: sfId, Name: z.string(), UserLicenseId: sfId });
export const licenseSchema = z.object({
  Id: sfId,
  Name: z.string(),
  TotalLicenses: z.number().int(),
  UsedLicenses: z.number().int(),
  Status: z.string(),
});
export const userSetupSchema = z.strictObject({
  org: z.strictObject({
    id: identifier,
    label: z.string(),
    salesforceOrgId: sfId,
    instanceOrigin: z.url(),
    status: z.string(),
    createdAt: z.number().int(),
    isSandbox: z.boolean().nullable(),
    organizationName: z.string().nullable(),
  }),
  isSandbox: z.boolean(),
  fields: z.array(
    z.strictObject({
      name: z.string(),
      label: z.string(),
      type: z.string(),
      required: z.boolean(),
      maxLength: z.number().int(),
      choices: z.array(
        z.strictObject({ value: z.string(), label: z.string(), defaultValue: z.boolean() }),
      ),
    }),
  ),
  profiles: z.array(profileSchema),
  licenses: z.array(licenseSchema),
  defaults: userDraftSchema.partial(),
  unsupportedRequiredFields: z.array(z.string()),
  bounded: z.literal(true),
});
export const userRecordSchema = z.object({
  Id: sfId,
  FirstName: z.string().nullable(),
  LastName: z.string(),
  Email: z.string(),
  Username: z.string(),
  Alias: z.string(),
  ProfileId: sfId,
  IsActive: z.boolean(),
  TimeZoneSidKey: z.string(),
  LocaleSidKey: z.string(),
  LanguageLocaleKey: z.string(),
  EmailEncodingKey: z.string(),
  CommunityNickname: z.string().nullable().optional(),
  CurrencyIsoCode: z.string().optional(),
  Title: z.string().nullable().optional(),
  Department: z.string().nullable().optional(),
  Phone: z.string().nullable().optional(),
  CreatedDate: z.string(),
  Profile: z.object({ Name: z.string(), UserLicenseId: sfId }),
});
export const assignmentSchema = z.object({
  Id: sfId,
  AssigneeId: sfId,
  PermissionSetId: sfId,
  PermissionSet: z.object({ Label: z.string(), Name: z.string() }),
});
export const availableSetSchema = z.object({
  Id: sfId,
  Name: z.string(),
  Label: z.string(),
  Description: z.string().nullable(),
  IsOwnedByProfile: z.boolean(),
  LicenseId: sfId.nullable(),
});
export const accessStateSchema = z.strictObject({
  user: userRecordSchema,
  assignments: z.array(assignmentSchema),
  permissionSets: z.array(
    z.strictObject({
      id: sfId,
      name: z.string(),
      label: z.string(),
      description: z.string().nullable(),
      licenseId: sfId.nullable(),
      userLicenseId: sfId.nullable(),
      compatible: z.boolean(),
      reason: z.string().nullable(),
    }),
  ),
  permissionSetLicenseIds: z.array(sfId),
  bounded: z.literal(true),
});
export const operationSchema = z.strictObject({
  id: identifier,
  kind: z.enum(["add", "remove"]),
  permissionSetId: sfId,
  assignmentId: sfId.nullable(),
  status: z.enum(["pending", "executing", "verified", "failed", "execution_unknown"]),
  providerRecordId: sfId.nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  error: z.string().nullable(),
});
const accessProposalSchema = z.strictObject({
  before: accessStateSchema,
  addPermissionSetIds: z.array(sfId).max(20),
  removeAssignmentIds: z.array(sfId).max(20),
  operations: z.array(operationSchema).max(40),
});
export const payloadSchema = z.strictObject({
  operationHistory: z.array(operationSchema).max(400).default([]),
  binding: connectionBindingSchema,
  setup: userSetupSchema,
  draft: userDraftSchema.partial(),
  createdUser: userRecordSchema.optional(),
  providerRecordId: sfId.optional(),
  accessProposal: accessProposalSchema.optional(),
});
export type Payload = z.infer<typeof payloadSchema>;
export const workflowSchema = z.strictObject({
  id: identifier,
  orgId: identifier,
  originatingGrantId: identifier.nullable(),
  intent: z.literal("create-user"),
  status: z.enum([
    "draft",
    "prepared",
    "creating",
    "execution_unknown",
    "failed",
    "access_pending",
    "access_prepared",
    "access_applying",
    "partial",
    "completed",
  ]),
  revision: z.number().int().positive(),
  digest: z.string().nullable(),
  recordId: sfId.nullable(),
  setup: userSetupSchema,
  draft: userDraftSchema.partial(),
  createdUser: userRecordSchema.optional(),
  accessProposal: accessProposalSchema.optional(),
  operationHistory: z.array(operationSchema).max(400),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export const prepareUserInputSchema = z.strictObject({
  orgId: identifier,
  draft: userDraftSchema.partial().optional(),
});
export const saveUserInputSchema = z.strictObject({
  workflowId: identifier,
  revision: z.number().int().positive(),
  draft: userDraftSchema,
});
export const accessProposalInputSchema = z.strictObject({
  workflowId: identifier,
  revision: z.number().int().positive(),
  addPermissionSetIds: z.array(sfId).max(20),
  removeAssignmentIds: z.array(sfId).max(20),
});

export const listWorkflowsSchema = z.strictObject({
  workflows: z.array(workflowSchema).max(50),
  limit: z.literal(50),
  bounded: z.literal(true),
});
export const listUsersInputSchema = z.strictObject({
  orgId: identifier,
  search: z.string().max(100).default(""),
  limit: z.number().int().min(1).max(100).default(50),
});
export const listUsersSchema = z.strictObject({
  org: userSetupSchema.shape.org,
  users: z.array(userRecordSchema).max(100),
  limit: z.number().int().min(1).max(100),
  bounded: z.literal(true),
  retrievedAt: z.iso.datetime(),
});
