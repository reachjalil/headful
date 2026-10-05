/* Adapted from Headful Cloud (Apache-2.0); see LICENSES/Headful-Cloud-Apache-2.0.txt. */
import { currentIso, httpDate } from "./security.ts";
// Adapted local desktop algorithm; cloud account and credential code are excluded.
import { z } from "zod";
import type { Env, Org, Principal } from "./types.ts";
import { HttpError } from "./types.ts";
import { audit, hash, identifier, now, random, seal, sfId, unseal } from "./security.ts";
import {
  apiName,
  API_VERSION,
  fieldFlags,
  fieldPermissionSchema,
  objectFlags,
  objectPermissionSchema,
  getApplication,
  permissionDetail,
  permissionSetSchema,
  query,
  requireOrg,
  sfRequest,
} from "./salesforce.ts";
import { consumeReview, mintReview, scope } from "./workflows.ts";
export const changeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("details"),
    label: z.string().trim().min(1).max(80),
    description: z.string().max(1000),
  }),
  z.strictObject({ kind: z.literal("object"), object: apiName, permissions: objectFlags }),
  z.strictObject({
    kind: z.literal("field"),
    object: apiName,
    field: apiName,
    permissions: fieldFlags,
  }),
]);
export const proposalInput = z.strictObject({
  orgId: identifier,
  permissionSetId: sfId,
  change: changeSchema,
});
const targetSchema = z.union([
  permissionSetSchema,
  objectPermissionSchema,
  fieldPermissionSchema,
  z.null(),
]);
const proposalPayload = z.strictObject({
  change: changeSchema,
  before: targetSchema,
  applicationId: identifier,
  applicationVersion: z.number().int().positive(),
  connectionVersion: z.number().int().positive(),
  instanceOrigin: z.url(),
  salesforceOrgId: sfId,
  salesforceUserId: sfId,
  result: z
    .strictObject({
      recordId: sfId,
      verifiedAt: z.iso.datetime(),
      readback: targetSchema,
      provider: z.literal("salesforce"),
      authority: z.literal("provider-receipt-and-readback"),
    })
    .optional(),
});
export type ProposalPayload = z.infer<typeof proposalPayload>;
interface ProposalRow {
  id: string;
  owner_id: string;
  org_id: string;
  permission_set_id: string;
  kind: string;
  envelope: string;
  digest: string;
  status: string;
  expires_at: number;
  created_at: number;
  execution_started_at: number | null;
}
function editable(set: z.infer<typeof permissionSetSchema>) {
  if (set.IsOwnedByProfile || !set.IsCustom || set.NamespacePrefix)
    throw new HttpError(
      403,
      "read_only",
      "This permission set is controlled by a profile, Salesforce, or a managed package. Edit a custom permission set.",
    );
}
export async function snapshot(
  env: Env,
  org: Org,
  setId: string,
  change: z.infer<typeof changeSchema>,
) {
  const detail = await permissionDetail(env, org, setId);
  editable(detail.permissionSet);
  if (change.kind === "details") return detail.permissionSet;
  const describe = z
    .object({
      name: z.string(),
      fields: z.array(z.object({ name: z.string(), permissionable: z.boolean() })),
    })
    .parse(
      await sfRequest(env, org, `/services/data/${API_VERSION}/sobjects/${change.object}/describe`),
    );
  if (describe.name !== change.object)
    throw new HttpError(400, "object", "Salesforce did not confirm this object.");
  if (change.kind === "object") {
    const found = await query(
      env,
      org,
      `SELECT Id,ParentId,SobjectType,PermissionsRead,PermissionsCreate,PermissionsEdit,PermissionsDelete,PermissionsViewAllRecords,PermissionsModifyAllRecords,LastModifiedDate,SystemModstamp FROM ObjectPermissions WHERE ParentId='${setId}' AND SobjectType='${change.object}' LIMIT 1`,
      objectPermissionSchema,
    );
    return found.records[0] ?? null;
  }
  if (!describe.fields.find((f) => f.name === change.field && f.permissionable))
    throw new HttpError(400, "field", "This field cannot have field-level permissions.");
  const found = await query(
    env,
    org,
    `SELECT Id,ParentId,SobjectType,Field,PermissionsRead,PermissionsEdit,LastModifiedDate,SystemModstamp FROM FieldPermissions WHERE ParentId='${setId}' AND Field='${change.object}.${change.field}' LIMIT 1`,
    fieldPermissionSchema,
  );
  return found.records[0] ?? null;
}
function after(change: z.infer<typeof changeSchema>) {
  return change.kind === "details"
    ? { Label: change.label, Description: change.description || null }
    : change.permissions;
}
function unchanged(before: ProposalPayload["before"], change: z.infer<typeof changeSchema>) {
  if (!before)
    return change.kind !== "details" && Object.values(change.permissions).every((v) => v === false);
  const next = after(change);
  return Object.entries(next).every(([k, v]) => (before as Record<string, unknown>)[k] === v);
}
export async function prepareChange(
  env: Env,
  principal: Principal,
  input: z.infer<typeof proposalInput>,
) {
  if (!principal.scopes.includes("headful:propose"))
    throw new HttpError(403, "scope", "This agent connection can only read Salesforce data.");
  const org = await requireOrg(env, principal, input.orgId),
    application = await getApplication(env, principal.user.id, org.application_id);
  const before = await snapshot(env, org, input.permissionSetId, input.change);
  if (unchanged(before, input.change))
    throw new HttpError(400, "unchanged", "These settings already match Salesforce.");
  const id = random(18),
    payload: ProposalPayload = {
      change: input.change,
      before,
      applicationId: org.application_id,
      applicationVersion: application.version,
      connectionVersion: org.connection_version,
      instanceOrigin: org.instance_origin,
      salesforceOrgId: org.salesforce_org_id,
      salesforceUserId: org.salesforce_user_id,
    };
  const digest = await hash(
    JSON.stringify({ owner: principal.user.id, org: org.id, set: input.permissionSetId, payload }),
  );
  const expires = now() + 10 * 60000;
  await env.DB.prepare(
    "INSERT INTO proposals(id,owner_id,org_id,permission_set_id,kind,envelope,digest,status,expires_at,created_at) VALUES (?,?,?,?,?,?,?,'pending',?,?)",
  )
    .bind(
      id,
      principal.user.id,
      org.id,
      input.permissionSetId,
      input.change.kind,
      await seal(env, "proposal:" + principal.user.id + ":" + id, payload),
      digest,
      expires,
      now(),
    )
    .run();
  await audit(env, principal.user.id, "permission_change_prepared", org.id, id);
  return {
    id,
    digest,
    expiresAt: expires,
    before,
    after: after(input.change),
    change: input.change,
    orgId: org.id,
    orgLabel: org.label,
    permissionSetId: input.permissionSetId,
    reviewUrl: "headful://workspace?view=review&orgId=" + org.id + "&proposalId=" + id,
    authority: "proposal-only-no-provider-write",
  };
}
async function load(env: Env, owner: string, id: string) {
  identifier.parse(id);
  const row = await env.DB.prepare("SELECT * FROM proposals WHERE id=? AND owner_id=?")
    .bind(id, owner)
    .first<ProposalRow>();
  if (!row) throw new HttpError(404, "proposal_missing", "This review is unavailable.");
  if (row.status === "executing" && row.execution_started_at! < now() - 60000) {
    await env.DB.prepare(
      "UPDATE proposals SET status='execution_unknown' WHERE id=? AND status='executing'",
    )
      .bind(id)
      .run();
    row.status = "execution_unknown";
  }
  return {
    row,
    payload: await unseal(env, "proposal:" + owner + ":" + id, row.envelope, proposalPayload),
  };
}
export async function getProposal(env: Env, owner: string, id: string) {
  const { row, payload } = await load(env, owner, id);
  return {
    id: row.id,
    digest: row.digest,
    orgId: row.org_id,
    permissionSetId: row.permission_set_id,
    change: payload.change,
    before: payload.before,
    after: after(payload.change),
    result: payload.result,
    status: row.status === "pending" && row.expires_at < now() ? "expired" : row.status,
    expiresAt: row.expires_at,
  };
}
async function executeChange(env: Env, principal: Principal, id: string, digest: string) {
  const { row, payload } = await load(env, principal.user.id, id);
  if (row.status !== "pending" || row.expires_at < now() || row.digest !== digest)
    throw new HttpError(
      409,
      "proposal_unavailable",
      "This exact review is no longer available. Prepare a new change.",
    );
  let org = await requireOrg(env, principal, row.org_id),
    application = await getApplication(env, principal.user.id, org.application_id);
  if (
    org.connection_version !== payload.connectionVersion ||
    application.version !== payload.applicationVersion ||
    org.instance_origin !== payload.instanceOrigin ||
    org.application_id !== payload.applicationId ||
    org.salesforce_org_id !== payload.salesforceOrgId ||
    org.salesforce_user_id !== payload.salesforceUserId
  )
    throw new HttpError(
      409,
      "connection_changed",
      "The org connection changed. Prepare a new review.",
    );
  const before = await snapshot(env, org, row.permission_set_id, payload.change);
  if ((await hash(JSON.stringify(before))) !== (await hash(JSON.stringify(payload.before)))) {
    await env.DB.prepare("UPDATE proposals SET status='stale' WHERE id=? AND status='pending'")
      .bind(id)
      .run();
    throw new HttpError(
      409,
      "stale",
      "Salesforce changed after this review was prepared. Reload and review again.",
    );
  }
  org = await requireOrg(env, principal, row.org_id);
  if (
    org.connection_version !== payload.connectionVersion ||
    org.instance_origin !== payload.instanceOrigin ||
    org.application_id !== payload.applicationId
  )
    throw new HttpError(
      409,
      "connection_changed",
      "The org connection changed. Prepare a new review.",
    );
  const claim = await env.DB.prepare(
    "UPDATE proposals SET status='executing',execution_started_at=? WHERE id=? AND owner_id=? AND status='pending' AND digest=? AND expires_at>?",
  )
    .bind(now(), id, principal.user.id, digest, now())
    .run();
  if (claim.meta.changes !== 1)
    throw new HttpError(409, "claimed", "This change has already been submitted.");
  let dispatched = false,
    providerAccepted = false;
  try {
    org = await requireOrg(env, principal, row.org_id);
    if (org.connection_version !== payload.connectionVersion)
      throw new HttpError(
        409,
        "connection_changed",
        "The org connection changed before execution.",
      );
    const change = payload.change;
    const object =
      change.kind === "details"
        ? "PermissionSet"
        : change.kind === "object"
          ? "ObjectPermissions"
          : "FieldPermissions";
    let recordId = change.kind === "details" ? row.permission_set_id : before?.Id;
    const fields = after(change);
    let receipt: unknown;
    if (recordId) {
      const modified = before?.LastModifiedDate;
      if (!modified || !Number.isFinite(Date.parse(modified)))
        throw new Error("Missing update precondition");
      dispatched = true;
      receipt = await sfRequest(
        env,
        org,
        `/services/data/${API_VERSION}/sobjects/${object}/${recordId}`,
        {
          method: "PATCH",
          headers: { "if-unmodified-since": httpDate(modified) },
          body: JSON.stringify(fields),
        },
        true,
      );
      providerAccepted = true;
    } else {
      if (change.kind === "details") throw new Error("Missing permission set");
      const createBody = {
        ...fields,
        ParentId: row.permission_set_id,
        SobjectType: change.object,
        ...(change.kind === "field" ? { Field: change.object + "." + change.field } : {}),
      };
      dispatched = true;
      receipt = await sfRequest(
        env,
        org,
        `/services/data/${API_VERSION}/sobjects/${object}`,
        { method: "POST", body: JSON.stringify(createBody) },
        true,
      );
      recordId = z.object({ id: sfId, success: z.literal(true) }).parse(receipt).id;
      providerAccepted = true;
    }
    const readback = await snapshot(env, org, row.permission_set_id, change);
    if (!unchanged(readback, change))
      throw new HttpError(
        502,
        "execution_unknown",
        "Salesforce did not confirm the reviewed values. Check the org before any further change.",
      );
    const result = {
      recordId,
      verifiedAt: currentIso(),
      readback,
      provider: "salesforce",
      authority: "provider-receipt-and-readback",
    };
    await env.DB.prepare(
      "UPDATE proposals SET status='completed',envelope=? WHERE id=? AND status='executing'",
    )
      .bind(await seal(env, "proposal:" + principal.user.id + ":" + id, { ...payload, result }), id)
      .run();
    await audit(env, principal.user.id, "permission_change_completed", row.org_id, id);
    return { status: "completed", result };
  } catch (error) {
    const definitelyRejected =
      !dispatched ||
      (!providerAccepted &&
        error instanceof HttpError &&
        ["provider_rejected", "provider_expired", "provider_stale"].includes(error.code));
    const status = definitelyRejected ? "failed" : "execution_unknown";
    await env.DB.prepare("UPDATE proposals SET status=? WHERE id=? AND status='executing'")
      .bind(status, id)
      .run();
    await audit(env, principal.user.id, "permission_change_" + status, row.org_id, id);
    if (status === "execution_unknown")
      throw new HttpError(
        502,
        status,
        "The result is uncertain. This proposal cannot be retried. Check the permission set directly in Salesforce.",
      );
    throw error;
  }
}
export const permissionApprovalInputSchema = z.strictObject({
  proposalId: identifier,
  digest: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  approvalToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export async function issuePermissionReview(env: Env, principal: Principal, proposalId: string) {
  scope(principal, "headful:permissions");
  const { row, payload } = await load(env, principal.user.id, proposalId);
  await requireOrg(env, principal, row.org_id);
  if (row.status !== "pending" || row.expires_at < now())
    throw new HttpError(409, "proposal_unavailable", "Prepare a new permission review.");
  const org = await requireOrg(env, principal, row.org_id);
  if (org.connection_version !== payload.connectionVersion)
    throw new HttpError(409, "connection_changed", "The org connection changed.");
  const review = await mintReview(
    env,
    principal,
    row.org_id,
    proposalId,
    "permission_edit",
    1,
    row.digest,
  );
  return { proposal: await getProposal(env, principal.user.id, proposalId), ...review };
}
export async function executePermissionReview(
  env: Env,
  principal: Principal,
  input: z.infer<typeof permissionApprovalInputSchema>,
) {
  scope(principal, "headful:permissions");
  const { row } = await load(env, principal.user.id, input.proposalId);
  if (row.digest !== input.digest || row.status !== "pending" || row.expires_at < now())
    throw new HttpError(409, "proposal_unavailable", "Review the current permission proposal.");
  await consumeReview(
    env,
    principal,
    row.org_id,
    row.id,
    "permission_edit",
    1,
    input.digest,
    input.approvalToken,
  );
  return executeChange(env, principal, row.id, input.digest);
}
