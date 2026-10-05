/* Adapted from Headful Cloud (Apache-2.0); see LICENSES/Headful-Cloud-Apache-2.0.txt. */
import { currentIso } from "./security.ts";
// Adapted local desktop algorithm; cloud account and credential code are excluded.
import { z } from "zod";
import type { Env, Principal } from "./types.ts";
import { HttpError } from "./types.ts";
import { API_VERSION, query, requireOrg, safeOrg } from "./salesforce.ts";
import { sfId } from "../../../../../packages/contracts/src/headful-workspace/contract-schema.ts";
import { salesforceV2LeadSchema } from "../../../../../packages/contracts/src/headful-workspace/inherited/lead-schema.ts";
const recordSchema = z.object({
  Id: sfId,
  Name: z.string(),
  Title: z.string().nullable(),
  Company: z.string(),
  Status: z.string(),
  LeadSource: z.string().nullable(),
  Rating: z.string().nullable(),
  Email: z.string().nullable(),
  Phone: z.string().nullable(),
  CreatedDate: z.string(),
  LastActivityDate: z.string().nullable(),
  Description: z.string().nullable(),
});
export async function getLead(
  env: Env,
  principal: Principal,
  input: { orgId: string; leadId: string },
) {
  if (!sfId.parse(input.leadId).startsWith("00Q"))
    throw new HttpError(400, "lead_id", "Select a Salesforce lead.");
  const org = await requireOrg(env, principal, input.orgId);
  const found = await query(
    env,
    org,
    `SELECT Id,Name,Title,Company,Status,LeadSource,Rating,Email,Phone,CreatedDate,LastActivityDate,Description FROM Lead WHERE Id='${input.leadId}' LIMIT 1`,
    recordSchema,
  );
  const r = found.records[0];
  if (!r) throw new HttpError(404, "lead_missing", "This Salesforce lead is unavailable.");
  const lead = salesforceV2LeadSchema.parse({
    id: r.Id,
    name: r.Name,
    title: r.Title || "Not supplied",
    company: r.Company,
    status: r.Status,
    source: r.LeadSource,
    rating: ["Hot", "Warm", "Cold"].includes(r.Rating ?? "") ? r.Rating : null,
    email: r.Email && z.email().safeParse(r.Email).success ? r.Email : null,
    phone: r.Phone,
    description: r.Description || null,
    createdAt: r.CreatedDate,
    lastActivityAt: r.LastActivityDate ? `${r.LastActivityDate}T00:00:00.000Z` : null,
  });
  return {
    org: safeOrg(org),
    lead,
    retrievedAt: currentIso(),
    authority: "connected-salesforce-read" as const,
  };
}
