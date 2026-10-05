/* Adapted from Headful Cloud (Apache-2.0); see LICENSES/Headful-Cloud-Apache-2.0.txt. */
// Adapted local desktop algorithm; cloud account and credential code are excluded.
export * from "../../../../../packages/contracts/src/headful-workspace/workflow-schema.ts";
import {
  connectionBindingSchema,
  reviewCapabilitySchema,
  type ConnectionBinding,
  type ReviewOperation,
} from "../../../../../packages/contracts/src/headful-workspace/workflow-schema.ts";
import type { Env, Org, Principal } from "./types.ts";
import { HttpError } from "./types.ts";
import { getApplication, requireOrg } from "./salesforce.ts";
import { hash, identifier, now, random, sfId } from "./security.ts";

export async function connectionBinding(env: Env, org: Org): Promise<ConnectionBinding> {
  const app = await getApplication(env, org.owner_id, org.application_id);
  return {
    applicationId: org.application_id,
    applicationVersion: app.version,
    connectionVersion: org.connection_version,
    instanceOrigin: org.instance_origin,
    salesforceOrgId: org.salesforce_org_id,
    salesforceUserId: org.salesforce_user_id,
  };
}
export async function boundOrg(
  env: Env,
  principal: Principal,
  id: string,
  binding: ConnectionBinding,
) {
  const org = await requireOrg(env, principal, id);
  if (
    (await hash(JSON.stringify(await connectionBinding(env, org)))) !==
    (await hash(JSON.stringify(binding)))
  )
    throw new HttpError(
      409,
      "connection_changed",
      "The org connection changed. Prepare a new review.",
    );
  return org;
}
export function scope(principal: Principal, required: string) {
  if (!principal.scopes.includes(required))
    throw new HttpError(
      403,
      "scope",
      `Reconnect the agent with ${required} to perform this operation.`,
    );
}
/** Return this only through an App-visible tool's UI-only _meta, or owner+CSRF browser API. */
export async function mintReview(
  env: Env,
  principal: Principal,
  orgId: string,
  targetId: string,
  operation: ReviewOperation,
  revision: number,
  digest: string,
) {
  if (principal.kind !== "desktop")
    throw new HttpError(
      403,
      "human_review_required",
      "Review and approve the exact change in the Headful desktop workspace.",
    );
  await requireOrg(env, principal, orgId);
  scope(
    principal,
    operation === "user_create"
      ? "headful:users"
      : operation === "access_apply"
        ? "headful:access"
        : "headful:permissions",
  );
  const token = random(),
    expiresAt = now() + 10 * 60000;
  await env.DB.prepare("INSERT INTO workflow_reviews VALUES (?,?,?,?,?,?,?,?,?,0,NULL)")
    .bind(
      await hash(token),
      principal.user.id,
      principal.grantId ?? null,
      orgId,
      targetId,
      operation,
      revision,
      digest,
      expiresAt,
    )
    .run();
  return reviewCapabilitySchema.parse({
    approvalToken: token,
    expiresAt,
    workflowId: targetId,
    revision,
    digest,
    operation,
  });
}
/** Consuming an exact capability is the explicit Create/Apply approval, never its issuance. */
export async function consumeReview(
  env: Env,
  principal: Principal,
  orgId: string,
  targetId: string,
  operation: ReviewOperation,
  revision: number,
  digest: string,
  token: string,
) {
  if (principal.kind !== "desktop")
    throw new HttpError(403, "human_review_required", "Approve this change in Headful.");
  scope(
    principal,
    operation === "user_create"
      ? "headful:users"
      : operation === "access_apply"
        ? "headful:access"
        : "headful:permissions",
  );
  await requireOrg(env, principal, orgId);
  const changed = await env.DB.prepare(
    "UPDATE workflow_reviews SET consumed=1,approved_at=? WHERE token_hash=? AND owner_id=? AND grant_id IS ? AND org_id=? AND target_id=? AND operation=? AND revision=? AND digest=? AND consumed=0 AND expires_at>?",
  )
    .bind(
      now(),
      await hash(token),
      principal.user.id,
      principal.grantId ?? null,
      orgId,
      targetId,
      operation,
      revision,
      digest,
      now(),
    )
    .run();
  if (changed.meta.changes !== 1)
    throw new HttpError(
      409,
      "approval_unavailable",
      "This exact approval is expired or already used. Review the current workflow again.",
    );
}
