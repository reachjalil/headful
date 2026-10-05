/* Adapted from Headful Cloud (Apache-2.0); see LICENSES/Headful-Cloud-Apache-2.0.txt. */
import { currentIso } from "./security.ts";
// Adapted local desktop algorithm; cloud account and credential code are excluded.
import { z } from "zod";
import type { Env, Principal } from "./types.ts";
import { HttpError } from "./types.ts";
import { API_VERSION, query, requireOrg, safeOrg, sfRequest, soqlEscape } from "./salesforce.ts";
import { audit, hash, identifier, now, random, seal, sfId, unseal } from "./security.ts";
import {
  approvalInputSchema,
  boundOrg,
  connectionBinding,
  connectionBindingSchema,
  consumeReview,
  mintReview,
  reviewRequestSchema,
  scope,
} from "./workflows.ts";

export * from "../../../../../packages/contracts/src/headful-workspace/user-schema.ts";
import {
  operationSchema,
  userDraftSchema,
  describeFieldSchema,
  profileSchema,
  licenseSchema,
  availableSetSchema,
  userSetupSchema,
  userRecordSchema,
  assignmentSchema,
  accessStateSchema,
  payloadSchema,
  workflowSchema,
  prepareUserInputSchema,
  saveUserInputSchema,
  accessProposalInputSchema,
  listWorkflowsSchema,
  listUsersInputSchema,
  listUsersSchema,
  type UserDraft,
  type Payload,
} from "../../../../../packages/contracts/src/headful-workspace/user-schema.ts";
const fields = Object.keys(userDraftSchema.shape);
interface Row {
  id: string;
  owner_id: string;
  grant_id: string | null;
  org_id: string;
  intent: string;
  status: string;
  revision: number;
  envelope: string;
  digest: string | null;
  record_id: string | null;
  execution_started_at: number | null;
  created_at: number;
  updated_at: number;
}
const userFields =
  "Id,FirstName,LastName,Email,Username,Alias,ProfileId,IsActive,TimeZoneSidKey,LocaleSidKey,LanguageLocaleKey,EmailEncodingKey,CommunityNickname,Title,Department,Phone,CreatedDate,Profile.Name,Profile.UserLicenseId";

export async function userSetup(env: Env, principal: Principal, orgId: string) {
  scope(principal, "headful:users");
  const org = await requireOrg(env, principal, orgId);
  const describe = z
    .object({
      name: z.literal("User"),
      createable: z.boolean(),
      fields: z.array(describeFieldSchema).max(1500),
    })
    .parse(await sfRequest(env, org, `/services/data/${API_VERSION}/sobjects/User/describe`));
  if (!describe.createable)
    throw new HttpError(
      403,
      "user_creation_unavailable",
      "Salesforce does not grant user creation to this connection.",
    );
  const profiles = await query(
      env,
      org,
      "SELECT Id,Name,UserLicenseId FROM Profile ORDER BY Name LIMIT 200",
      profileSchema,
    ),
    licenses = await query(
      env,
      org,
      "SELECT Id,Name,TotalLicenses,UsedLicenses,Status FROM UserLicense ORDER BY Name LIMIT 200",
      licenseSchema,
    );
  const current = await query(
    env,
    org,
    `SELECT ${userFields}${describe.fields.some((f) => f.name === "CurrencyIsoCode") ? ",CurrencyIsoCode" : ""} FROM User WHERE Id='${org.salesforce_user_id}' LIMIT 1`,
    userRecordSchema,
  );
  const organization = await query(
    env,
    org,
    "SELECT Id,Name,IsSandbox FROM Organization LIMIT 1",
    z.object({ Id: sfId, Name: z.string(), IsSandbox: z.boolean() }),
  );
  if (
    !organization.records[0] ||
    organization.records[0].Id.slice(0, 15) !== org.salesforce_org_id.slice(0, 15)
  )
    throw new HttpError(502, "provider_identity", "Salesforce did not confirm this org.");
  await env.DB.prepare(
    "UPDATE orgs SET is_sandbox=?,organization_name=? WHERE id=? AND owner_id=? AND connection_version=?",
  )
    .bind(
      organization.records[0].IsSandbox ? 1 : 0,
      organization.records[0].Name,
      org.id,
      org.owner_id,
      org.connection_version,
    )
    .run();
  org.is_sandbox = organization.records[0].IsSandbox ? 1 : 0;
  org.organization_name = organization.records[0].Name;
  const defaults: Partial<UserDraft> = { IsActive: true };
  for (const key of [
    "TimeZoneSidKey",
    "LocaleSidKey",
    "LanguageLocaleKey",
    "EmailEncodingKey",
    "CurrencyIsoCode",
  ] as const) {
    const value = current.records[0]?.[key];
    if (value) defaults[key] = value;
  }
  const visible = describe.fields.filter((f) => fields.includes(f.name) && f.createable);
  for (const field of visible) {
    const choice = field.picklistValues.find((p) => p.active && p.defaultValue);
    if (choice && !Object.hasOwn(defaults, field.name) && field.name !== "ProfileId")
      Object.assign(defaults, { [field.name]: choice.value });
  }
  return userSetupSchema.parse({
    org: safeOrg(org),
    isSandbox: organization.records[0].IsSandbox,
    fields: visible.map((f) => ({
      name: f.name,
      label: f.label,
      type: f.type,
      required: !f.nillable && !f.defaultedOnCreate,
      maxLength: f.length,
      choices: f.picklistValues
        .filter((p) => p.active)
        .map((p) => ({ value: p.value, label: p.label, defaultValue: p.defaultValue })),
    })),
    profiles: profiles.records,
    licenses: licenses.records,
    defaults,
    unsupportedRequiredFields: describe.fields
      .filter(
        (f) => f.createable && !f.nillable && !f.defaultedOnCreate && !fields.includes(f.name),
      )
      .map((f) => f.name),
    bounded: true,
  });
}
function validateDraft(draft: UserDraft, setup: z.infer<typeof userSetupSchema>) {
  if (setup.unsupportedRequiredFields.length)
    throw new HttpError(
      400,
      "unsupported_required_fields",
      "This org requires additional User fields. Create this user directly in Salesforce.",
    );
  const profile = setup.profiles.find((p) => p.Id === draft.ProfileId),
    license = profile && setup.licenses.find((l) => l.Id === profile.UserLicenseId);
  if (!profile || !license || license.Status !== "Active")
    throw new HttpError(
      400,
      "profile_unavailable",
      "Choose an available Salesforce profile and license.",
    );
  if (draft.IsActive && license.TotalLicenses >= 0 && license.UsedLicenses >= license.TotalLicenses)
    throw new HttpError(409, "license_unavailable", "This profile has no available user licenses.");
  for (const [key, value] of Object.entries(draft)) {
    const field = setup.fields.find((f) => f.name === key);
    if (!field) {
      if (value === "") continue;
      throw new HttpError(
        400,
        "unsupported_field",
        `Salesforce does not allow ${key} for this user.`,
      );
    }
    if (typeof value === "string" && field.maxLength > 0 && value.length > field.maxLength)
      throw new HttpError(400, "field_length", `${field.label} is too long.`);
    if (field.choices.length && !field.choices.some((c) => c.value === value))
      throw new HttpError(400, "field_choice", `Choose an available ${field.label}.`);
  }
  for (const field of setup.fields)
    if (field.required && !Object.hasOwn(draft, field.name))
      throw new HttpError(400, "required_field", `${field.label} is required.`);
}
async function load(env: Env, principal: Principal, id: string) {
  identifier.parse(id);
  scope(principal, "headful:read");
  scope(principal, "headful:users");
  const row = await env.DB.prepare("SELECT * FROM workflows WHERE id=? AND owner_id=?")
    .bind(id, principal.user.id)
    .first<Row>();
  if (!row || (principal.grantId && row.grant_id && row.grant_id !== principal.grantId))
    throw new HttpError(404, "workflow_missing", "This workflow is unavailable.");
  await requireOrg(env, principal, row.org_id);
  if (
    ["creating", "access_applying"].includes(row.status) &&
    row.execution_started_at! < now() - 300000
  ) {
    await env.DB.prepare(
      "UPDATE workflows SET status='execution_unknown',updated_at=? WHERE id=? AND status=?",
    )
      .bind(now(), id, row.status)
      .run();
    row.status = "execution_unknown";
  }
  return {
    row,
    payload: await unseal(env, "workflow:" + row.owner_id + ":" + id, row.envelope, payloadSchema),
  };
}
function view(row: Row, payload: Payload) {
  return workflowSchema.parse({
    id: row.id,
    orgId: row.org_id,
    originatingGrantId: row.grant_id,
    intent: row.intent,
    status: row.status,
    revision: row.revision,
    digest: row.digest,
    recordId: row.record_id,
    setup: payload.setup,
    draft: payload.draft,
    ...(payload.createdUser ? { createdUser: payload.createdUser } : {}),
    ...(payload.accessProposal ? { accessProposal: payload.accessProposal } : {}),
    operationHistory: payload.operationHistory,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
export async function getWorkflow(env: Env, principal: Principal, id: string) {
  const { row, payload } = await load(env, principal, id);
  return view(row, payload);
}
export async function listWorkflows(env: Env, principal: Principal) {
  scope(principal, "headful:users");
  const rows = await env.DB.prepare(
    "SELECT id,org_id,grant_id FROM workflows WHERE owner_id=? ORDER BY updated_at DESC LIMIT 50",
  )
    .bind(principal.user.id)
    .all<{ id: string; org_id: string; grant_id: string | null }>();
  const workflows = [];
  for (const row of rows.results) {
    if (
      (principal.orgIds && !principal.orgIds.includes(row.org_id)) ||
      (principal.grantId && row.grant_id && row.grant_id !== principal.grantId)
    )
      continue;
    try {
      workflows.push(await getWorkflow(env, principal, row.id));
    } catch (error) {
      if (!(error instanceof HttpError && error.code === "org_missing")) throw error;
    }
  }
  return listWorkflowsSchema.parse({ workflows, limit: 50, bounded: true });
}
export async function listUsers(
  env: Env,
  principal: Principal,
  input: { orgId: string; search?: string; limit?: number },
) {
  scope(principal, "headful:users");
  const parsed = listUsersInputSchema.parse(input),
    org = await requireOrg(env, principal, parsed.orgId),
    filter = parsed.search
      ? ` WHERE (Name LIKE '%${soqlEscape(parsed.search)}%' OR Email LIKE '%${soqlEscape(parsed.search)}%')`
      : "";
  const result = await query(
    env,
    org,
    `SELECT ${userFields} FROM User${filter} ORDER BY Name LIMIT ${parsed.limit}`,
    userRecordSchema,
  );
  return listUsersSchema.parse({
    org: safeOrg(org),
    users: result.records,
    limit: parsed.limit,
    bounded: true,
    retrievedAt: currentIso(),
  });
}
async function digest(row: Row, payload: Payload) {
  return hash(
    JSON.stringify({
      owner: row.owner_id,
      grant: row.grant_id,
      org: row.org_id,
      id: row.id,
      revision: row.revision,
      payload,
    }),
  );
}
export async function prepareUserCreation(
  env: Env,
  principal: Principal,
  input: z.infer<typeof prepareUserInputSchema>,
) {
  scope(principal, "headful:propose");
  const org = await requireOrg(env, principal, input.orgId),
    setup = await userSetup(env, principal, org.id),
    id = random(18),
    at = now();
  const payload: Payload = {
    operationHistory: [],
    binding: await connectionBinding(env, org),
    setup,
    draft: { ...setup.defaults, ...input.draft },
  };
  await env.DB.prepare(
    "INSERT INTO workflows VALUES (?,?,?,?,'create-user','draft',1,?,NULL,NULL,NULL,?,?)",
  )
    .bind(
      id,
      principal.user.id,
      principal.grantId ?? null,
      org.id,
      await seal(env, "workflow:" + principal.user.id + ":" + id, payload),
      at,
      at,
    )
    .run();
  await audit(env, principal.user.id, "user_draft_prepared", org.id, id);
  return getWorkflow(env, principal, id);
}
export async function saveUserDraft(
  env: Env,
  principal: Principal,
  input: z.infer<typeof saveUserInputSchema>,
) {
  scope(principal, "headful:propose");
  const { row, payload } = await load(env, principal, input.workflowId);
  if (
    row.revision !== input.revision ||
    !["draft", "prepared", "failed"].includes(row.status) ||
    row.record_id
  )
    throw new HttpError(
      409,
      "workflow_revision",
      "This draft changed or user creation already started. Reload it.",
    );
  const org = await boundOrg(env, principal, row.org_id, payload.binding),
    setup = await userSetup(env, principal, org.id);
  validateDraft(input.draft, setup);
  const next = { ...payload, setup, draft: input.draft };
  const revised = { ...row, revision: row.revision + 1 };
  const exact = await digest(revised, next);
  const changed = await env.DB.prepare(
    "UPDATE workflows SET envelope=?,revision=?,digest=?,status='prepared',updated_at=? WHERE id=? AND owner_id=? AND revision=? AND status IN ('draft','prepared','failed') AND record_id IS NULL",
  )
    .bind(
      await seal(env, "workflow:" + row.owner_id + ":" + row.id, next),
      revised.revision,
      exact,
      now(),
      row.id,
      row.owner_id,
      row.revision,
    )
    .run();
  if (changed.meta.changes !== 1)
    throw new HttpError(409, "workflow_revision", "This draft changed. Reload it.");
  return getWorkflow(env, principal, row.id);
}
export async function workflowReview(
  env: Env,
  principal: Principal,
  input: z.infer<typeof reviewRequestSchema>,
) {
  const { row, payload } = await load(env, principal, input.workflowId);
  if (
    row.revision !== input.revision ||
    row.digest !== input.digest ||
    !["prepared", "access_prepared"].includes(row.status)
  )
    throw new HttpError(409, "review_stale", "Review the current workflow revision.");
  await boundOrg(env, principal, row.org_id, payload.binding);
  return mintReview(
    env,
    principal,
    row.org_id,
    row.id,
    row.status === "prepared" ? "user_create" : "access_apply",
    row.revision,
    row.digest,
  );
}
export async function inspectUser(
  env: Env,
  principal: Principal,
  selection: string | { orgId: string; userId: string },
  recordId?: string,
  includeCurrency = false,
) {
  scope(principal, "headful:users");
  const orgId = typeof selection === "string" ? selection : selection.orgId,
    id = typeof selection === "string" ? recordId! : selection.userId;
  sfId.parse(id);
  if (!id.startsWith("005")) throw new HttpError(400, "user_id", "Select a Salesforce user.");
  const org = await requireOrg(env, principal, orgId);
  const result = await query(
    env,
    org,
    `SELECT ${userFields}${includeCurrency ? ",CurrencyIsoCode" : ""} FROM User WHERE Id='${id}' LIMIT 1`,
    userRecordSchema,
  );
  if (!result.records[0])
    throw new HttpError(404, "user_missing", "This Salesforce user is unavailable.");
  return result.records[0];
}
function matches(record: z.infer<typeof userRecordSchema>, draft: UserDraft) {
  return Object.entries(draft).every(([key, value]) =>
    value === "" && key === "FirstName"
      ? record.FirstName === null || record.FirstName === ""
      : Object.hasOwn(record, key) && (record as Record<string, unknown>)[key] === value,
  );
}
async function persist(
  env: Env,
  row: Row,
  payload: Payload,
  status: string,
  recordId: string | null = row.record_id,
) {
  await env.DB.prepare(
    "UPDATE workflows SET envelope=?,status=?,record_id=?,updated_at=?,execution_started_at=? WHERE id=? AND owner_id=? AND revision=?",
  )
    .bind(
      await seal(env, "workflow:" + row.owner_id + ":" + row.id, payload),
      status,
      recordId,
      now(),
      ["creating", "access_applying"].includes(status) ? now() : row.execution_started_at,
      row.id,
      row.owner_id,
      row.revision,
    )
    .run();
}
function definite(error: unknown) {
  return (
    error instanceof HttpError &&
    ["provider_rejected", "provider_expired", "provider_stale", "connection_changed"].includes(
      error.code,
    )
  );
}
export async function approveUserCreation(
  env: Env,
  principal: Principal,
  input: z.infer<typeof approvalInputSchema>,
) {
  const { row, payload } = await load(env, principal, input.workflowId);
  if (
    row.status !== "prepared" ||
    row.revision !== input.revision ||
    row.digest !== input.digest ||
    row.record_id
  )
    throw new HttpError(409, "review_stale", "This creation review is no longer available.");
  const org = await boundOrg(env, principal, row.org_id, payload.binding),
    draft = userDraftSchema.parse(payload.draft);
  validateDraft(draft, await userSetup(env, principal, org.id));
  const duplicate = await query(
    env,
    org,
    `SELECT Id FROM User WHERE Username='${soqlEscape(draft.Username)}' LIMIT 1`,
    z.object({ Id: sfId }),
  );
  if (duplicate.records.length)
    throw new HttpError(
      409,
      "username_exists",
      "This username is already present in this org. Review the existing user.",
    );
  await consumeReview(
    env,
    principal,
    row.org_id,
    row.id,
    "user_create",
    row.revision,
    input.digest,
    input.approvalToken,
  );
  const claim = await env.DB.prepare(
    "UPDATE workflows SET status='creating',execution_started_at=?,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND digest=? AND status='prepared' AND record_id IS NULL",
  )
    .bind(now(), now(), row.id, row.owner_id, row.revision, input.digest)
    .run();
  if (claim.meta.changes !== 1)
    throw new HttpError(
      409,
      "already_submitted",
      "This user creation already started. Reload its status.",
    );
  let dispatched = false;
  try {
    await boundOrg(env, principal, row.org_id, payload.binding);
    dispatched = true;
    const receipt = z
      .object({ id: sfId, success: z.literal(true) })
      .parse(
        await sfRequest(
          env,
          org,
          `/services/data/${API_VERSION}/sobjects/User`,
          { method: "POST", body: JSON.stringify(draft) },
          true,
        ),
      );
    payload.providerRecordId = receipt.id;
    await persist(env, row, payload, "creating", receipt.id);
    const created = await inspectUser(
      env,
      principal,
      row.org_id,
      receipt.id,
      Boolean(draft.CurrencyIsoCode),
    );
    if (!matches(created, draft))
      throw new HttpError(502, "execution_unknown", "Salesforce did not verify the created user.");
    payload.createdUser = created;
    await persist(env, row, payload, "access_pending", receipt.id);
    await audit(env, row.owner_id, "user_created_verified", row.org_id, row.id);
    return getWorkflow(env, principal, row.id);
  } catch (error) {
    const rejected = !dispatched || (!payload.providerRecordId && definite(error));
    await persist(
      env,
      row,
      payload,
      rejected ? "failed" : "execution_unknown",
      payload.providerRecordId ?? null,
    );
    await audit(
      env,
      row.owner_id,
      "user_creation_" + (rejected ? "failed" : "execution_unknown"),
      row.org_id,
      row.id,
    );
    throw new HttpError(
      rejected ? 502 : 409,
      rejected ? "user_creation_failed" : "execution_unknown",
      rejected
        ? "Salesforce rejected user creation. Review the fields and provider authority."
        : "The creation outcome is uncertain. Reconcile this workflow before any other action; it cannot be retried.",
    );
  }
}
export async function reconcileUserCreation(env: Env, principal: Principal, id: string) {
  const { row, payload } = await load(env, principal, id);
  if (row.status !== "execution_unknown" || payload.createdUser)
    throw new HttpError(
      409,
      "reconciliation_unavailable",
      "This workflow does not have an uncertain user creation.",
    );
  const org = await boundOrg(env, principal, row.org_id, payload.binding),
    draft = userDraftSchema.parse(payload.draft);
  const found = await query(
    env,
    org,
    `SELECT ${userFields}${draft.CurrencyIsoCode ? ",CurrencyIsoCode" : ""} FROM User WHERE Username='${soqlEscape(draft.Username)}' LIMIT 2`,
    userRecordSchema,
  );
  if (
    found.records.length !== 1 ||
    !matches(found.records[0]!, draft) ||
    Date.parse(found.records[0]!.CreatedDate) <
      (row.execution_started_at ?? row.created_at) - 5000 ||
    (payload.providerRecordId && found.records[0]!.Id !== payload.providerRecordId)
  )
    throw new HttpError(
      409,
      "reconciliation_unconfirmed",
      "Salesforce has not uniquely confirmed this creation. The workflow remains uncertain and cannot be retried.",
    );
  payload.createdUser = found.records[0]!;
  payload.providerRecordId = found.records[0]!.Id;
  await persist(env, row, payload, "access_pending", found.records[0]!.Id);
  await audit(env, row.owner_id, "user_creation_reconciled", row.org_id, row.id);
  return getWorkflow(env, principal, id);
}

export async function userAccess(
  env: Env,
  principal: Principal,
  input: { orgId: string; userId: string },
) {
  scope(principal, "headful:access");
  const user = await inspectUser(env, principal, input.orgId, input.userId),
    org = await requireOrg(env, principal, input.orgId);
  const assignments = await query(
    env,
    org,
    `SELECT Id,AssigneeId,PermissionSetId,PermissionSet.Label,PermissionSet.Name FROM PermissionSetAssignment WHERE AssigneeId='${user.Id}' ORDER BY Id LIMIT 201`,
    assignmentSchema,
  );
  if (assignments.records.length > 200 || !assignments.done)
    throw new HttpError(
      400,
      "access_bound",
      "This user has more than 200 assignments. Manage their access directly in Salesforce.",
    );
  const permissionSets = await query(
    env,
    org,
    "SELECT Id,Name,Label,Description,IsOwnedByProfile,LicenseId FROM PermissionSet WHERE IsOwnedByProfile=false ORDER BY Label LIMIT 200",
    availableSetSchema,
  );
  const userLicenses = await query(
      env,
      org,
      "SELECT Id FROM UserLicense LIMIT 200",
      z.object({ Id: sfId }),
    ),
    knownUserLicenseIds = userLicenses.records.map((l) => l.Id);
  const licenses = await query(
      env,
      org,
      `SELECT PermissionSetLicenseId FROM PermissionSetLicenseAssign WHERE AssigneeId='${user.Id}' LIMIT 200`,
      z.object({ PermissionSetLicenseId: sfId }),
    ),
    licenseIds = licenses.records.map((l) => l.PermissionSetLicenseId);
  return accessStateSchema.parse({
    user,
    assignments: assignments.records,
    permissionSetLicenseIds: licenseIds,
    permissionSets: permissionSets.records.map((set) => {
      const userLicenseId =
          set.LicenseId && knownUserLicenseIds.includes(set.LicenseId) ? set.LicenseId : null,
        wrongUserLicense = Boolean(userLicenseId && userLicenseId !== user.Profile.UserLicenseId),
        missingPermissionLicense = Boolean(
          set.LicenseId && !userLicenseId && !licenseIds.includes(set.LicenseId),
        );
      return {
        id: set.Id,
        name: set.Name,
        label: set.Label,
        description: set.Description,
        licenseId: set.LicenseId,
        userLicenseId,
        compatible: !set.IsOwnedByProfile && !wrongUserLicense && !missingPermissionLicense,
        reason: set.IsOwnedByProfile
          ? "Profile-owned permission set"
          : wrongUserLicense
            ? "The permission set requires a different user license."
            : missingPermissionLicense
              ? "The user does not hold the required permission set license."
              : null,
      };
    }),
    bounded: true,
  });
}
export async function workflowAccess(env: Env, principal: Principal, id: string) {
  const { row, payload } = await load(env, principal, id);
  if (!payload.createdUser || !row.record_id)
    throw new HttpError(
      409,
      "user_not_created",
      "User creation must be verified before access setup.",
    );
  return userAccess(env, principal, { orgId: row.org_id, userId: row.record_id });
}
function assignmentDigest(state: z.infer<typeof accessStateSchema>) {
  return JSON.stringify({
    userId: state.user.Id,
    profileId: state.user.ProfileId,
    userLicenseId: state.user.Profile.UserLicenseId,
    active: state.user.IsActive,
    assignments: state.assignments.map((a) => ({ id: a.Id, permissionSetId: a.PermissionSetId })),
    licenses: [...state.permissionSetLicenseIds].sort(),
  });
}
export async function prepareAccessChange(
  env: Env,
  principal: Principal,
  input: z.infer<typeof accessProposalInputSchema>,
) {
  scope(principal, "headful:access");
  scope(principal, "headful:propose");
  const { row, payload } = await load(env, principal, input.workflowId);
  if (
    row.revision !== input.revision ||
    !payload.createdUser ||
    !row.record_id ||
    !["access_pending", "access_prepared", "partial", "completed"].includes(row.status)
  )
    throw new HttpError(
      409,
      "access_unavailable",
      "Reload the verified user before preparing access changes.",
    );
  if (
    payload.accessProposal?.operations.some((o) =>
      ["executing", "execution_unknown"].includes(o.status),
    )
  )
    throw new HttpError(
      409,
      "reconciliation_required",
      "Reconcile the uncertain assignment before preparing another change.",
    );
  await boundOrg(env, principal, row.org_id, payload.binding);
  const before = await userAccess(env, principal, { orgId: row.org_id, userId: row.record_id });
  const adds = [...new Set(input.addPermissionSetIds)],
    removes = [...new Set(input.removeAssignmentIds)];
  if (!adds.length && !removes.length)
    throw new HttpError(400, "unchanged", "Select at least one assignment to add or remove.");
  for (const id of adds) {
    const set = before.permissionSets.find((s) => s.id === id);
    if (!set || !set.compatible)
      throw new HttpError(
        400,
        "incompatible_permission_set",
        set?.reason ?? "Select an available permission set.",
      );
    if (before.assignments.some((a) => a.PermissionSetId === id))
      throw new HttpError(409, "assignment_exists", "This permission set is already assigned.");
  }
  for (const id of removes) {
    const assigned = before.assignments.find((a) => a.Id === id);
    if (!assigned || adds.includes(assigned.PermissionSetId))
      throw new HttpError(
        400,
        "invalid_assignment",
        "Select an existing assignment with no conflicting addition.",
      );
  }
  const operations: z.infer<typeof operationSchema>[] = adds.map((id) => ({
    id: random(18),
    kind: "add",
    permissionSetId: id,
    assignmentId: null,
    status: "pending",
    providerRecordId: null,
    verifiedAt: null,
    error: null,
  }));
  operations.push(
    ...removes.map((id) => ({
      id: random(18),
      kind: "remove" as const,
      permissionSetId: before.assignments.find((a) => a.Id === id)!.PermissionSetId,
      assignmentId: id,
      status: "pending" as const,
      providerRecordId: null,
      verifiedAt: null,
      error: null,
    })),
  );
  const history = [...payload.operationHistory, ...(payload.accessProposal?.operations ?? [])];
  if (history.length > 400)
    throw new HttpError(
      400,
      "workflow_bound",
      "This workflow has reached its operation history bound. Manage further access directly in Salesforce.",
    );
  const next: Payload = {
      ...payload,
      operationHistory: history,
      accessProposal: {
        before: {
          ...before,
          permissionSets: before.permissionSets.filter((s) => adds.includes(s.id)),
        },
        addPermissionSetIds: adds,
        removeAssignmentIds: removes,
        operations,
      },
    },
    revised = { ...row, revision: row.revision + 1 };
  const exact = await digest(revised, next);
  const changed = await env.DB.prepare(
    "UPDATE workflows SET envelope=?,revision=?,digest=?,status='access_prepared',updated_at=? WHERE id=? AND owner_id=? AND revision=? AND status IN ('access_pending','access_prepared','partial','completed')",
  )
    .bind(
      await seal(env, "workflow:" + row.owner_id + ":" + row.id, next),
      revised.revision,
      exact,
      now(),
      row.id,
      row.owner_id,
      row.revision,
    )
    .run();
  if (changed.meta.changes !== 1)
    throw new HttpError(409, "workflow_revision", "This workflow changed. Reload it.");
  return getWorkflow(env, principal, row.id);
}
export async function applyAccessChange(
  env: Env,
  principal: Principal,
  input: z.infer<typeof approvalInputSchema>,
) {
  const { row, payload } = await load(env, principal, input.workflowId);
  if (
    row.status !== "access_prepared" ||
    row.revision !== input.revision ||
    row.digest !== input.digest ||
    !row.record_id ||
    !payload.accessProposal
  )
    throw new HttpError(409, "review_stale", "Review the current assignment proposal.");
  const org = await boundOrg(env, principal, row.org_id, payload.binding),
    proposal = payload.accessProposal;
  let current = await userAccess(env, principal, { orgId: row.org_id, userId: row.record_id });
  if (assignmentDigest(current) !== assignmentDigest(proposal.before))
    throw new HttpError(
      409,
      "stale",
      "The user’s assignments, profile or licenses changed. Prepare a new review.",
    );
  for (const id of proposal.addPermissionSetIds)
    if (
      !current.permissionSets.find((s) => s.id === id && s.compatible) ||
      JSON.stringify(current.permissionSets.find((s) => s.id === id)) !==
        JSON.stringify(proposal.before.permissionSets.find((s) => s.id === id))
    )
      throw new HttpError(
        409,
        "incompatible_permission_set",
        "Permission-set compatibility changed. Prepare a new review.",
      );
  await consumeReview(
    env,
    principal,
    row.org_id,
    row.id,
    "access_apply",
    row.revision,
    input.digest,
    input.approvalToken,
  );
  const claim = await env.DB.prepare(
    "UPDATE workflows SET status='access_applying',execution_started_at=?,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND digest=? AND status='access_prepared'",
  )
    .bind(now(), now(), row.id, row.owner_id, row.revision, input.digest)
    .run();
  if (claim.meta.changes !== 1)
    throw new HttpError(409, "already_submitted", "This assignment review already started.");
  for (const operation of proposal.operations) {
    operation.status = "executing";
    await persist(env, row, payload, "access_applying");
    let dispatched = false;
    try {
      const fresh = await userAccess(env, principal, { orgId: row.org_id, userId: row.record_id });
      if (assignmentDigest(fresh) !== assignmentDigest(current))
        throw new HttpError(409, "provider_stale", "The user’s access changed during this review.");
      if (
        operation.kind === "add" &&
        !fresh.permissionSets.find((s) => s.id === operation.permissionSetId && s.compatible)
      )
        throw new HttpError(409, "provider_stale", "Permission-set compatibility changed.");
      await boundOrg(env, principal, row.org_id, payload.binding);
      dispatched = true;
      if (operation.kind === "add") {
        const receipt = z.object({ id: sfId, success: z.literal(true) }).parse(
          await sfRequest(
            env,
            org,
            `/services/data/${API_VERSION}/sobjects/PermissionSetAssignment`,
            {
              method: "POST",
              body: JSON.stringify({
                AssigneeId: row.record_id,
                PermissionSetId: operation.permissionSetId,
              }),
            },
            true,
          ),
        );
        operation.providerRecordId = receipt.id;
      } else {
        await sfRequest(
          env,
          org,
          `/services/data/${API_VERSION}/sobjects/PermissionSetAssignment/${operation.assignmentId}`,
          { method: "DELETE" },
          true,
        );
        operation.providerRecordId = operation.assignmentId;
      }
      await persist(env, row, payload, "access_applying");
      const readback = await userAccess(env, principal, {
        orgId: row.org_id,
        userId: row.record_id,
      });
      if (
        operation.kind === "add"
          ? !readback.assignments.some(
              (a) =>
                a.Id === operation.providerRecordId &&
                a.PermissionSetId === operation.permissionSetId,
            )
          : readback.assignments.some((a) => a.Id === operation.assignmentId)
      )
        throw new HttpError(
          502,
          "execution_unknown",
          "Salesforce did not verify this assignment operation.",
        );
      operation.status = "verified";
      operation.verifiedAt = currentIso();
      current = readback;
      await persist(env, row, payload, "access_applying");
    } catch (error) {
      const rejected = !dispatched || (!operation.providerRecordId && definite(error));
      operation.status = rejected ? "failed" : "execution_unknown";
      operation.error = rejected
        ? "Salesforce rejected this assignment. Confirm the user license and provider permissions."
        : "The assignment outcome is uncertain. Reconcile it before further changes.";
      await persist(env, row, payload, "partial");
      await audit(env, row.owner_id, "user_access_partial", row.org_id, row.id);
      return getWorkflow(env, principal, row.id);
    }
  }
  await persist(env, row, payload, "completed");
  await audit(env, row.owner_id, "user_access_verified", row.org_id, row.id);
  return getWorkflow(env, principal, row.id);
}
export async function reconcileAccess(env: Env, principal: Principal, id: string) {
  const { row, payload } = await load(env, principal, id);
  if (
    !row.record_id ||
    !payload.createdUser ||
    !payload.accessProposal ||
    !["partial", "execution_unknown"].includes(row.status)
  )
    throw new HttpError(
      409,
      "reconciliation_unavailable",
      "No uncertain access operation is available.",
    );
  await boundOrg(env, principal, row.org_id, payload.binding);
  const current = await userAccess(env, principal, { orgId: row.org_id, userId: row.record_id });
  if (
    !payload.accessProposal.operations.some((o) =>
      ["execution_unknown", "executing"].includes(o.status),
    )
  )
    throw new HttpError(
      409,
      "reconciliation_unavailable",
      "There is no uncertain assignment to reconcile. Prepare a reviewed correction for rejected operations.",
    );
  for (const operation of payload.accessProposal.operations) {
    if (!["execution_unknown", "executing"].includes(operation.status)) continue;
    const matches = current.assignments.filter(
      (a) => a.PermissionSetId === operation.permissionSetId,
    );
    const confirmed =
      operation.kind === "add"
        ? matches.length === 1 &&
          (!operation.providerRecordId || matches[0]!.Id === operation.providerRecordId)
        : !current.assignments.some((a) => a.Id === operation.assignmentId);
    if (!confirmed)
      throw new HttpError(
        409,
        "reconciliation_unconfirmed",
        "Salesforce has not confirmed this assignment outcome. It cannot be retried.",
      );
    operation.providerRecordId = operation.kind === "add" ? matches[0]!.Id : operation.assignmentId;
    operation.status = "verified";
    operation.verifiedAt = currentIso();
    operation.error = null;
  }
  await persist(
    env,
    row,
    payload,
    payload.accessProposal.operations.every((o) => o.status === "verified")
      ? "completed"
      : "partial",
  );
  await audit(env, row.owner_id, "user_access_reconciled", row.org_id, row.id);
  return getWorkflow(env, principal, id);
}
