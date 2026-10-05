/* Adapted from Headful Cloud (Apache-2.0); see LICENSES/Headful-Cloud-Apache-2.0.txt. */
// Adapted for the public Headful desktop from the original Headful workspace.
import { z } from "zod";
export const identifier = z.string().regex(/^[A-Za-z0-9_-]{16,80}$/);
export const sfId = z.string().regex(/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/);
export const orgSchema = z.strictObject({
  id: identifier,
  label: z.string().max(80),
  salesforceOrgId: sfId,
  instanceOrigin: z.url(),
  status: z.string(),
  createdAt: z.number().int(),
  isSandbox: z.boolean().nullable(),
  organizationName: z.string().nullable(),
});
export const orgsSchema = z.object({ orgs: z.array(orgSchema).max(50) });
export const locationSchema = z.strictObject({
  view: z
    .enum([
      "home",
      "users",
      "user",
      "permission-sets",
      "permission-set",
      "review",
      "leads",
      "lead",
      "workflows",
      "create-user",
    ])
    .default("home"),
  orgId: identifier.optional(),
  recordId: sfId.optional(),
  workflowId: identifier.optional(),
  proposalId: identifier.optional(),
});
