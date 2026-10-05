/* Adapted from Headful Cloud (Apache-2.0); see LICENSES/Headful-Cloud-Apache-2.0.txt. */
// Adapted for the public Headful desktop from the original Headful workspace.
import { z } from "zod";
import { identifier, sfId } from "./contract-schema.ts";
export const connectionBindingSchema = z.strictObject({
  applicationId: identifier,
  applicationVersion: z.number().int().positive(),
  connectionVersion: z.number().int().positive(),
  instanceOrigin: z.url(),
  salesforceOrgId: sfId,
  salesforceUserId: sfId,
});
export type ConnectionBinding = z.infer<typeof connectionBindingSchema>;
export const approvalInputSchema = z.strictObject({
  workflowId: identifier,
  revision: z.number().int().positive(),
  digest: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  approvalToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const reviewRequestSchema = approvalInputSchema.omit({ approvalToken: true });
export const reviewCapabilitySchema = z.strictObject({
  approvalToken: z.string(),
  expiresAt: z.number().int(),
  workflowId: identifier,
  revision: z.number().int().positive(),
  digest: z.string(),
  operation: z.enum(["user_create", "access_apply", "permission_edit"]),
});
export type ReviewOperation = z.infer<typeof reviewCapabilitySchema>["operation"];
