import { z } from "zod";
import {
  extensionFeatureIdSchema,
  headfulExtensionInputSchemas,
  headfulExtensionResultSchemas,
} from "./headful-extensions.ts";
import { identifier, sfId } from "./headful-workspace/contract-schema.ts";
import {
  userDraftSchema,
  prepareUserInputSchema,
  saveUserInputSchema,
  accessProposalInputSchema,
} from "./headful-workspace/user-schema.ts";
import { reviewRequestSchema, approvalInputSchema } from "./headful-workspace/workflow-schema.ts";
import { permissionChangeSchema } from "./headful-workspace/ui-schema.ts";
export const headfulFeatureIds = [
  "org-management",
  "salesforce-workspace",
  "external-harness",
  "local-mcp",
  "reviewed-changes",
  "internal-chat",
  "agent-providers",
  "launch-at-login",
] as const;
const empty = z.strictObject({}),
  org = z.strictObject({ orgId: identifier }),
  workflow = z.strictObject({ workflowId: identifier });
const search = z.string().trim().max(100).default("");
export const headfulInputSchemas = {
  ...headfulExtensionInputSchemas,
  status: empty,
  "cli.detect": empty,
  "cli.configure": z.strictObject({ path: z.string().max(2000).nullable() }),
  "orgs.list": empty,
  "orgs.discover": empty,
  "orgs.import": z.strictObject({
    username: z.string().min(1).max(255),
    alias: z.string().trim().max(80).optional(),
    label: z.string().trim().min(1).max(80).optional(),
    color: z
      .string()
      .regex(/^#[a-fA-F0-9]{6}$/)
      .optional(),
  }),
  "orgs.login": z.strictObject({
    environment: z.enum(["production", "sandbox", "my-domain"]),
    instanceOrigin: z.url().optional(),
    alias: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/)
      .optional(),
  }),
  "orgs.update": z.strictObject({
    orgId: identifier,
    alias: z.string().trim().max(80).optional(),
    label: z.string().trim().min(1).max(80).optional(),
    color: z
      .string()
      .regex(/^#[a-fA-F0-9]{6}$/)
      .optional(),
    agentEnabled: z.boolean().optional(),
  }),
  "orgs.default": org,
  "orgs.remove": org,
  "orgs.health": org,
  "orgs.open": org,
  "orgs.logout": z.strictObject({ orgId: identifier, confirmLogout: z.literal(true) }),
  "orgs.sandboxes": org,
  "features.list": empty,
  "features.set": z.strictObject({ id: extensionFeatureIdSchema, enabled: z.boolean() }),
  "onboarding.complete": z.strictObject({
    mode: z.enum(["minimal", "power-user"]).default("minimal"),
  }),
  "activity.list": empty,
  listOrgs: empty,
  listLeads: z.strictObject({
    orgId: identifier,
    search,
    limit: z.number().int().min(1).max(100).default(50),
    page: z.number().int().min(1).max(41).default(1),
  }),
  inspectLead: z.strictObject({ orgId: identifier, leadId: sfId }),
  listPermissionSets: z.strictObject({ orgId: identifier, search }),
  inspectPermissionSet: z.strictObject({ orgId: identifier, permissionSetId: sfId }),
  preparePermissionChange: z.strictObject({
    orgId: identifier,
    permissionSetId: sfId,
    change: permissionChangeSchema,
  }),
  getPermissionProposal: z.strictObject({ proposalId: identifier }),
  reviewPermissionProposal: z.strictObject({
    proposalId: identifier,
    digest: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }),
  applyPermissionProposal: z.strictObject({
    proposalId: identifier,
    digest: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    approvalToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }),
  rejectPermissionProposal: z.strictObject({
    proposalId: identifier,
    digest: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }),
  listUsers: z.strictObject({
    orgId: identifier,
    search,
    limit: z.number().int().min(1).max(100).default(50),
  }),
  inspectUser: z.strictObject({ orgId: identifier, userId: sfId }),
  inspectUserAccess: z.strictObject({ orgId: identifier, userId: sfId }),
  listWorkflows: empty,
  prepareUserCreation: prepareUserInputSchema,
  getWorkflow: workflow,
  saveUserDraft: saveUserInputSchema,
  reviewWorkflow: reviewRequestSchema,
  createUser: approvalInputSchema,
  reconcileUser: workflow,
  getUserAccess: workflow,
  prepareUserAccess: accessProposalInputSchema,
  applyUserAccess: approvalInputSchema,
  reconcileAccess: workflow,
} as const;
export type HeadfulOperation = keyof typeof headfulInputSchemas;
export type HeadfulInput<K extends HeadfulOperation> = z.input<(typeof headfulInputSchemas)[K]>;
export interface HeadfulAuthority {
  kind: "desktop" | "mcp";
  clientId?: string;
  orgIds?: string[];
  scopes?: string[];
}
export const headfulRpcRequestSchema = z.strictObject({
  operation: z.enum(Object.keys(headfulInputSchemas) as [HeadfulOperation, ...HeadfulOperation[]]),
  input: z.unknown(),
});
export const headfulProtocolVersion = "headful-local-v1";
export type HeadfulUserDraft = z.infer<typeof userDraftSchema>;

import { orgSchema, orgsSchema } from "./headful-workspace/contract-schema.ts";
import {
  userRecordSchema,
  workflowSchema,
  listWorkflowsSchema,
  listUsersSchema,
  accessStateSchema,
} from "./headful-workspace/user-schema.ts";
import { reviewCapabilitySchema } from "./headful-workspace/workflow-schema.ts";
import {
  leadDatasetSchema,
  leadDetailSchema,
  permissionListSchema,
  permissionDetailSchema,
  permissionProposalSchema,
  preparedPermissionSchema,
} from "./headful-workspace/ui-schema.ts";
const managedOrgSchema = orgSchema.extend({
  username: z.string(),
  principalId: sfId,
  alias: z.string(),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  agentEnabled: z.boolean(),
  isDefault: z.boolean(),
  connectionVersion: z.number().int().positive(),
});
const managedOrgsSchema = z.strictObject({
  orgs: z.array(managedOrgSchema).max(100),
  defaultOrgId: identifier.nullable(),
});
const featuresSchema = z.strictObject({
  features: z.array(
    z.strictObject({
      id: extensionFeatureIdSchema,
      name: z.string(),
      description: z.string(),
      availability: z.enum(["available", "experimental"]),
      defaultEnabled: z.boolean(),
      dependencies: z.array(extensionFeatureIdSchema),
      configuration: z.array(z.string()),
      permissions: z.array(z.string()),
      route: z.string(),
      lifecycle: z.string(),
      enabled: z.boolean(),
      extensionId: z.string().optional(),
    }),
  ),
  mode: z.enum(["minimal", "power-user"]),
  onboardingComplete: z.boolean(),
});
const cliDetectionSchema = z.strictObject({
  state: z.enum(["missing", "ready", "unsupported", "multiple"]),
  installations: z.array(
    z.strictObject({
      path: z.string(),
      version: z.string(),
      supported: z.boolean(),
      source: z.enum(["configured", "path", "common"]),
    }),
  ),
  selected: z.string().nullable(),
  installerUrl: z.url(),
  architecture: z.string(),
  legacyDetected: z.boolean(),
});
export const headfulResultSchemas = {
  ...headfulExtensionResultSchemas,
  status: managedOrgsSchema.extend({
    ...featuresSchema.shape,
    product: z.literal("Headful"),
    protocol: z.literal("headful-local-v1"),
    local: z.literal(true),
    accountRequired: z.literal(false),
  }),
  "cli.detect": cliDetectionSchema,
  "cli.configure": cliDetectionSchema,
  "orgs.list": managedOrgsSchema,
  "orgs.discover": z.strictObject({
    connections: z
      .array(
        z.object({
          orgId: z.string().optional(),
          username: z.string(),
          alias: z.string().optional(),
          instanceUrl: z.string().optional(),
          isSandbox: z.boolean().optional(),
          connectedStatus: z.string().optional(),
          expirationDate: z.string().optional(),
          environment: z.enum(["production", "sandbox", "scratch", "unknown"]),
        }),
      )
      .max(100),
    bounded: z.literal(true),
  }),
  "orgs.import": managedOrgSchema,
  "orgs.login": managedOrgSchema,
  "orgs.update": managedOrgsSchema,
  "orgs.default": managedOrgsSchema,
  "orgs.remove": managedOrgsSchema,
  "orgs.logout": managedOrgsSchema,
  "orgs.health": managedOrgSchema,
  "orgs.open": z.strictObject({ opened: z.literal(true) }),
  "orgs.sandboxes": z.strictObject({
    org: orgSchema,
    sandboxes: z
      .array(
        z.strictObject({
          Id: sfId,
          SandboxName: z.string(),
          Description: z.string().nullable(),
          LicenseType: z.string().nullable(),
          connected: z.literal(false),
          loginOrigin: z.literal("https://test.salesforce.com"),
        }),
      )
      .max(100),
    availability: z.enum(["production-only", "available", "unavailable"]),
    message: z.string().optional(),
    bounded: z.literal(true),
  }),
  "features.list": featuresSchema,
  "features.set": featuresSchema,
  "onboarding.complete": featuresSchema,
  "activity.list": z.strictObject({
    activity: z
      .array(
        z.strictObject({
          id: z.number().int(),
          kind: z.string(),
          org_id: identifier.nullable(),
          target_id: identifier.nullable(),
          created_at: z.number().int(),
        }),
      )
      .max(100),
    bounded: z.literal(true),
  }),
  listOrgs: orgsSchema,
  listLeads: leadDatasetSchema,
  inspectLead: leadDetailSchema,
  listPermissionSets: permissionListSchema,
  inspectPermissionSet: permissionDetailSchema,
  preparePermissionChange: preparedPermissionSchema,
  getPermissionProposal: permissionProposalSchema,
  reviewPermissionProposal: reviewCapabilitySchema,
  applyPermissionProposal: permissionProposalSchema,
  rejectPermissionProposal: z.strictObject({ status: z.literal("rejected") }),
  listUsers: listUsersSchema,
  inspectUser: userRecordSchema,
  inspectUserAccess: accessStateSchema,
  listWorkflows: listWorkflowsSchema,
  prepareUserCreation: workflowSchema,
  getWorkflow: workflowSchema,
  saveUserDraft: workflowSchema,
  reviewWorkflow: reviewCapabilitySchema,
  createUser: workflowSchema,
  reconcileUser: workflowSchema,
  getUserAccess: accessStateSchema,
  prepareUserAccess: workflowSchema,
  applyUserAccess: workflowSchema,
  reconcileAccess: workflowSchema,
} as const;
export type HeadfulResult<K extends HeadfulOperation> = z.output<(typeof headfulResultSchemas)[K]>;
