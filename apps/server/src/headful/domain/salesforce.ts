/* Adapted from Headful Cloud (Apache-2.0); see LICENSES/Headful-Cloud-Apache-2.0.txt. */
import { currentIso } from "./security.ts";
import { z } from "zod";
import type { Env, Org, Principal } from "./types.ts";
import { HttpError } from "./types.ts";
import { directRequest, publicOrg } from "../OrgService.ts";
import {
  sfId,
  identifier,
} from "../../../../../packages/contracts/src/headful-workspace/contract-schema.ts";
import { salesforceV2LeadSchema } from "../../../../../packages/contracts/src/headful-workspace/inherited/lead-schema.ts";
export const API_VERSION = "v67.0";
export const apiName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/);
export const safeOrg = publicOrg;
export async function requireOrg(env: Env, principal: Principal, id: string): Promise<Org> {
  identifier.parse(id);
  const org = env.DB.db.prepare("SELECT * FROM orgs WHERE id=?").get(id) as unknown as
    | Org
    | undefined;
  if (!org || (principal.orgIds && !principal.orgIds.includes(id)))
    throw new HttpError(404, "org_missing", "This org is unavailable to this client.");
  if (
    principal.kind === "mcp" &&
    principal.source === "connect" &&
    env.DB.preference<unknown>(`remote:org:${id}:enabled`, false) !== true
  )
    throw new HttpError(
      403,
      "remote_org_disabled",
      "Remote access for this org is disabled on the Mac.",
    );
  if (principal.kind === "mcp" && principal.source !== "connect" && !org.agent_enabled)
    throw new HttpError(403, "org_disabled", "Agent access for this org is disabled.");
  return org;
}
export const getApplication = async (_env: Env, _owner: string, id: string) => ({ id, version: 1 });
export const sfRequest = async (
  env: Env,
  org: Org,
  path: string,
  init: RequestInit = {},
  write = false,
) => directRequest(env.cli, org, path, init, write);
const queryEnvelope = <T extends z.ZodType>(schema: T) =>
  z.object({
    totalSize: z.number().int().nonnegative(),
    done: z.boolean(),
    records: z.array(schema).max(1000),
  });
export async function query<T>(env: Env, org: Org, soql: string, schema: z.ZodType<T>) {
  const raw = await sfRequest(
    env,
    org,
    `/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`,
  );
  return queryEnvelope(schema).parse(raw);
}
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
  LastModifiedDate: z.string().refine((v) => Number.isFinite(Date.parse(v))),
  SystemModstamp: z.string(),
});
export const fieldPermissionSchema = z.object({
  Id: sfId,
  ParentId: sfId,
  SobjectType: apiName,
  Field: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*$/),
  PermissionsRead: z.boolean(),
  PermissionsEdit: z.boolean(),
  LastModifiedDate: z.string().refine((v) => Number.isFinite(Date.parse(v))),
  SystemModstamp: z.string(),
});
export const objectFlags = z
  .strictObject({
    PermissionsRead: z.boolean(),
    PermissionsCreate: z.boolean(),
    PermissionsEdit: z.boolean(),
    PermissionsDelete: z.boolean(),
    PermissionsViewAllRecords: z.boolean(),
    PermissionsModifyAllRecords: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (
      (v.PermissionsCreate ||
        v.PermissionsEdit ||
        v.PermissionsDelete ||
        v.PermissionsViewAllRecords) &&
      !v.PermissionsRead
    )
      ctx.addIssue({ code: "custom", message: "Read access is required for these permissions." });
    if (
      v.PermissionsModifyAllRecords &&
      !(
        v.PermissionsRead &&
        v.PermissionsEdit &&
        v.PermissionsDelete &&
        v.PermissionsViewAllRecords
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Modify All requires Read, Edit, Delete and View All.",
      });
  });
export const fieldFlags = z
  .strictObject({ PermissionsRead: z.boolean(), PermissionsEdit: z.boolean() })
  .refine((v) => !v.PermissionsEdit || v.PermissionsRead, "Edit requires Read.");
const psFields =
  "Id,Name,Label,Description,IsOwnedByProfile,IsCustom,NamespacePrefix,LastModifiedDate";
export async function permissionSets(env: Env, org: Org, search = "") {
  const clause = search
    ? ` AND (Label LIKE '%${soqlEscape(search)}%' OR Name LIKE '%${soqlEscape(search)}%')`
    : "";
  return query(
    env,
    org,
    `SELECT ${psFields} FROM PermissionSet WHERE IsOwnedByProfile=false${clause} ORDER BY Label LIMIT 200`,
    permissionSetSchema,
  );
}
export async function permissionDetail(env: Env, org: Org, id: string) {
  sfId.parse(id);
  if (!id.startsWith("0PS")) throw new HttpError(400, "permission_id", "Select a permission set.");
  const set = await query(
    env,
    org,
    `SELECT ${psFields} FROM PermissionSet WHERE Id='${id}' LIMIT 1`,
    permissionSetSchema,
  );
  if (!set.records[0]) throw new HttpError(404, "permission_missing", "Permission set not found.");
  const objects = await query(
    env,
    org,
    `SELECT Id,ParentId,SobjectType,PermissionsRead,PermissionsCreate,PermissionsEdit,PermissionsDelete,PermissionsViewAllRecords,PermissionsModifyAllRecords,LastModifiedDate,SystemModstamp FROM ObjectPermissions WHERE ParentId='${id}' ORDER BY SobjectType LIMIT 200`,
    objectPermissionSchema,
  );
  const fields = await query(
    env,
    org,
    `SELECT Id,ParentId,SobjectType,Field,PermissionsRead,PermissionsEdit,LastModifiedDate,SystemModstamp FROM FieldPermissions WHERE ParentId='${id}' ORDER BY Field LIMIT 200`,
    fieldPermissionSchema,
  );
  return {
    permissionSet: set.records[0],
    objects: objects.records,
    fields: fields.records,
    bounded: true,
    objectLimit: 200,
    fieldLimit: 200,
  };
}
export function soqlEscape(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
const leadRecord = z.object({
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
});
export async function leads(env: Env, org: Org, search = "", limit = 50, page = 1) {
  const offset = (page - 1) * limit;
  if (offset > 2000)
    throw new HttpError(
      400,
      "page_bound",
      "Salesforce supports up to 2,000 skipped leads. Refine your search.",
    );
  const clause = search
    ? ` AND (Name LIKE '%${soqlEscape(search)}%' OR Company LIKE '%${soqlEscape(search)}%')`
    : "";
  const result = await query(
    env,
    org,
    `SELECT Id,Name,Title,Company,Status,LeadSource,Rating,Email,Phone,CreatedDate,LastActivityDate FROM Lead WHERE IsConverted=false${clause} ORDER BY LastModifiedDate DESC LIMIT ${z.number().int().min(1).max(100).parse(limit) + 1} OFFSET ${offset}`,
    leadRecord,
  );
  const records = result.records.slice(0, limit).map((r) =>
    salesforceV2LeadSchema.parse({
      id: r.Id,
      name: r.Name,
      title: r.Title || "Not supplied",
      company: r.Company,
      status: r.Status,
      source: r.LeadSource,
      rating: ["Hot", "Warm", "Cold"].includes(r.Rating ?? "") ? r.Rating : null,
      email: r.Email && z.email().safeParse(r.Email).success ? r.Email : null,
      phone: r.Phone,
      createdAt: r.CreatedDate,
      lastActivityAt: r.LastActivityDate ? `${r.LastActivityDate}T00:00:00.000Z` : null,
    }),
  );
  return {
    org: safeOrg(org),
    leads: records,
    retrievedAt: currentIso(),
    authority: "connected-salesforce-read" as const,
    limit,
    bounded: true,
    page,
    hasMore: result.records.length > limit && offset + limit <= 2000,
  };
}
