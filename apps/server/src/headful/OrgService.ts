import { now } from "./domain/security.ts";
import * as NodeCrypto from "node:crypto";
import { z } from "zod";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Store from "./Store.ts";
import * as SalesforceCli from "./SalesforceCli.ts";
import { HttpError, type Org } from "./domain/types.ts";
import { assertSalesforceRequest, salesforceJson } from "./SalesforceHttp.ts";
const sfId = z.string().regex(/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/);
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const canonicalIdentity = (id: string) => sfId.parse(id).slice(0, 15);
export function publicOrg(org: Org) {
  return {
    id: org.id,
    label: org.label,
    salesforceOrgId: org.salesforce_org_id,
    instanceOrigin: org.instance_origin,
    status: org.status,
    createdAt: org.created_at,
    isSandbox: org.is_sandbox === null ? null : Boolean(org.is_sandbox),
    organizationName: org.organization_name,
  };
}
export function managedOrg(
  org: Org,
  isDefault: boolean,
  remoteEnabled = false,
  environment?: "production" | "sandbox" | "scratch" | "developer" | "unknown",
) {
  return {
    ...publicOrg(org),
    environment:
      environment ??
      (org.is_sandbox === null ? "unknown" : org.is_sandbox ? "sandbox" : "production"),
    username: org.username,
    principalId: org.salesforce_user_id,
    alias: org.alias,
    color: org.color,
    agentEnabled: Boolean(org.agent_enabled),
    remoteEnabled,
    isDefault,
    connectionVersion: org.connection_version,
  };
}
/** CLI owns auth. When its display format omits userId, confirm the token's actual subject directly with Salesforce. */
async function verifiedSession(cli: SalesforceCli.CliAdapter, username: string) {
  const session = await cli.session(username);
  if (session.userId) return { ...session, userId: sfId.parse(session.userId) };
  const identity = z
    .object({ user_id: sfId, organization_id: sfId, preferred_username: z.string().optional() })
    .parse(
      await salesforceJson(
        session.instanceOrigin + "/services/oauth2/userinfo",
        session.accessToken,
        {},
        false,
        200000,
      ),
    );
  if (
    canonicalIdentity(identity.organization_id) !== canonicalIdentity(session.orgId) ||
    (identity.preferred_username && identity.preferred_username !== session.username)
  )
    throw new HttpError(
      409,
      "connection_changed",
      "Salesforce authorization identifies a different org or principal.",
    );
  return { ...session, userId: identity.user_id };
}
const pendingReadSessions = new WeakMap<
  SalesforceCli.CliAdapter,
  Map<string, Promise<Awaited<ReturnType<typeof verifiedSession>>>>
>();
function readSession(cli: SalesforceCli.CliAdapter, username: string) {
  let pending = pendingReadSessions.get(cli);
  if (!pending) {
    pending = new Map();
    pendingReadSessions.set(cli, pending);
  }
  let session = pending.get(username);
  if (!session) {
    session = verifiedSession(cli, username).finally(() => pending.delete(username));
    pending.set(username, session);
  }
  return session;
}
/** Credentials are re-obtained from Salesforce CLI and never persisted by Headful. */
export async function verifiedOrgSession(
  cli: SalesforceCli.CliAdapter,
  org: Pick<Org, "username" | "salesforce_org_id" | "salesforce_user_id" | "instance_origin">,
  fresh = false,
) {
  const session = await (fresh
    ? verifiedSession(cli, org.username)
    : readSession(cli, org.username));
  if (
    canonicalIdentity(session.orgId) !== canonicalIdentity(org.salesforce_org_id) ||
    session.username !== org.username ||
    session.instanceOrigin !== org.instance_origin ||
    (session.userId &&
      canonicalIdentity(session.userId) !== canonicalIdentity(org.salesforce_user_id))
  )
    throw new HttpError(
      409,
      "connection_changed",
      "Salesforce CLI now resolves to a different org or principal. Reconnect and review again.",
    );
  return session;
}
export async function directRequest(
  cli: SalesforceCli.CliAdapter,
  org: Pick<Org, "username" | "salesforce_org_id" | "salesforce_user_id" | "instance_origin">,
  path: string,
  init: RequestInit = {},
  write = false,
) {
  assertSalesforceRequest(path, init, write);
  if (init.signal?.aborted)
    throw new HttpError(
      409,
      "provider_cancelled",
      "This Salesforce request was cancelled before dispatch.",
    );
  const session = await verifiedOrgSession(cli, org, write);
  return salesforceJson(session.instanceOrigin + path, session.accessToken, init, write);
}

/** One read operation pins one verified token; the callback cannot issue writes or outlive the operation. */
export async function withVerifiedRead<T>(
  cli: SalesforceCli.CliAdapter,
  org: Pick<Org, "username" | "salesforce_org_id" | "salesforce_user_id" | "instance_origin">,
  run: (read: (path: string) => Promise<unknown>) => Promise<T>,
) {
  const session = await verifiedOrgSession(cli, org);
  const lifetime = new AbortController();
  const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(20000)]);
  try {
    return await run(async (path) => {
      assertSalesforceRequest(path, {}, false);
      return salesforceJson(session.instanceOrigin + path, session.accessToken, { signal });
    });
  } finally {
    lifetime.abort();
  }
}

export class OrgManager {
  readonly store: Store.LocalStore;
  readonly cli: SalesforceCli.CliAdapter;
  constructor(store: Store.LocalStore, cli: SalesforceCli.CliAdapter) {
    this.store = store;
    this.cli = cli;
  }
  rows() {
    return this.store.db
      .prepare("SELECT * FROM orgs ORDER BY created_at")
      .all() as unknown as Org[];
  }
  get(id: string) {
    const org = this.store.db.prepare("SELECT * FROM orgs WHERE id=?").get(id) as unknown as
      | Org
      | undefined;
    if (!org) throw new HttpError(404, "org_missing", "This Headful org reference is unavailable.");
    return org;
  }
  remoteEnabled(id: string) {
    return this.store.preference<unknown>(`remote:org:${id}:enabled`, false) === true;
  }
  list() {
    const selected = this.store.preference<string | null>("defaultOrgId", null);
    return {
      orgs: this.rows().map((org) =>
        managedOrg(
          org,
          org.id === selected,
          this.remoteEnabled(org.id),
          this.store.preference(`org:environment:${org.id}`, undefined),
        ),
      ),
      defaultOrgId: selected,
    };
  }
  async import(
    username: string,
    options: {
      alias?: string | undefined;
      label?: string | undefined;
      color?: string | undefined;
      reconnect?: boolean | undefined;
    } = {},
  ) {
    const session = await verifiedSession(this.cli, username);
    const organization = z
      .object({
        records: z
          .array(
            z.object({
              Id: sfId,
              Name: z.string(),
              IsSandbox: z.boolean(),
              OrganizationType: z.string().optional(),
            }),
          )
          .max(1),
      })
      .parse(
        await this.bootstrap(
          session,
          `SELECT Id,Name,IsSandbox,OrganizationType FROM Organization LIMIT 1`,
        ),
      ).records[0];
    const principal = z
      .object({ records: z.array(z.object({ Id: sfId, Username: z.string() })).max(1) })
      .parse(
        await this.bootstrap(
          session,
          `SELECT Id,Username FROM User WHERE Id='${session.userId}' LIMIT 1`,
        ),
      ).records[0];
    if (
      !organization ||
      !principal ||
      canonicalIdentity(organization.Id) !== canonicalIdentity(session.orgId) ||
      canonicalIdentity(principal.Id) !== canonicalIdentity(session.userId) ||
      principal.Username !== session.username
    )
      throw new HttpError(
        409,
        "identity_unverified",
        "Salesforce did not verify the exact org and authenticated principal.",
      );
    const existing = this.rows().find(
      (o) =>
        canonicalIdentity(o.salesforce_org_id) === canonicalIdentity(organization.Id) &&
        canonicalIdentity(o.salesforce_user_id) === canonicalIdentity(principal.Id),
    );
    if (!existing && this.rows().length >= 50)
      throw new HttpError(
        400,
        "org_bound",
        "Headful currently supports up to 50 imported org connections.",
      );
    const connectionVersion = existing
      ? existing.connection_version +
        (options.reconnect ||
        existing.instance_origin !== session.instanceOrigin ||
        existing.username !== session.username
          ? 1
          : 0)
      : 1;
    const id = existing?.id ?? NodeCrypto.randomBytes(18).toString("base64url");
    const alias = z
      .string()
      .trim()
      .max(80)
      .parse(options.alias ?? existing?.alias ?? "");
    const label = z
      .string()
      .trim()
      .min(1)
      .max(80)
      .parse(options.label ?? existing?.label ?? (alias || organization.Name.slice(0, 80)));
    const color = colorSchema.parse(options.color ?? existing?.color ?? "#626dd2");
    this.store.db
      .prepare(
        `INSERT INTO orgs(id,application_id,label,salesforce_org_id,salesforce_user_id,instance_origin,username,alias,color,agent_enabled,connection_version,is_sandbox,organization_name,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,instance_origin=excluded.instance_origin,username=excluded.username,alias=excluded.alias,color=excluded.color,is_sandbox=excluded.is_sandbox,organization_name=excluded.organization_name,status='connected',connection_version=excluded.connection_version`,
      )
      .run(
        id,
        id,
        label,
        organization.Id,
        principal.Id,
        session.instanceOrigin,
        session.username,
        alias,
        color,
        existing?.agent_enabled ?? 0,
        connectionVersion,
        organization.IsSandbox ? 1 : 0,
        organization.Name,
        "connected",
        now(),
      );
    if (!this.store.preference("defaultOrgId", null)) this.store.setPreference("defaultOrgId", id);
    this.store.setPreference(
      `org:environment:${id}`,
      this.cli.discoveredEnvironment(organization.Id, session.username) === "scratch"
        ? "scratch"
        : organization.OrganizationType === "Developer Edition"
          ? "developer"
          : organization.IsSandbox
            ? "sandbox"
            : "production",
    );
    this.store.activity("org_imported", id);
    return managedOrg(
      this.get(id),
      this.store.preference("defaultOrgId", null) === id,
      this.remoteEnabled(id),
      this.store.preference(`org:environment:${id}`, undefined),
    );
  }
  private async bootstrap(session: SalesforceCli.CliSession, soql: string) {
    return salesforceJson(
      session.instanceOrigin + "/services/data/v67.0/query?q=" + encodeURIComponent(soql),
      session.accessToken,
      {},
      false,
      100000,
    );
  }

  update(
    id: string,
    patch: {
      alias?: string | undefined;
      label?: string | undefined;
      color?: string | undefined;
      agentEnabled?: boolean | undefined;
      remoteEnabled?: boolean | undefined;
    },
  ) {
    const org = this.get(id);
    this.store.db
      .prepare("UPDATE orgs SET alias=?,label=?,color=?,agent_enabled=? WHERE id=?")
      .run(
        patch.alias ?? org.alias,
        patch.label ?? org.label,
        patch.color ?? org.color,
        patch.agentEnabled === undefined ? org.agent_enabled : Number(patch.agentEnabled),
        id,
      );
    if (patch.remoteEnabled !== undefined)
      this.store.setPreference(`remote:org:${id}:enabled`, patch.remoteEnabled);
    return this.list();
  }
  setDefault(id: string) {
    this.get(id);
    this.store.setPreference("defaultOrgId", id);
    return this.list();
  }
  remove(id: string) {
    this.get(id);
    this.store.db.prepare("DELETE FROM orgs WHERE id=?").run(id);
    this.store.setPreference(`remote:org:${id}:enabled`, false);
    if (this.store.preference("defaultOrgId", null) === id)
      this.store.setPreference("defaultOrgId", this.rows()[0]?.id ?? null);
    this.store.activity("org_reference_removed", id);
    return this.list();
  }
  async health(id: string) {
    const org = this.get(id);
    try {
      await directRequest(this.cli, org, "/services/data/v67.0/limits");
      this.store.db.prepare("UPDATE orgs SET status='connected' WHERE id=?").run(id);
    } catch (error) {
      this.store.db
        .prepare("UPDATE orgs SET status=? WHERE id=?")
        .run(
          error instanceof HttpError && error.code === "connection_changed"
            ? "identity-changed"
            : "reconnect-required",
          id,
        );
    }
    return managedOrg(
      this.get(id),
      this.store.preference("defaultOrgId", null) === id,
      this.remoteEnabled(id),
    );
  }
  async sandboxes(id: string) {
    const org = this.get(id);
    if (org.is_sandbox)
      return { org: publicOrg(org), sandboxes: [], availability: "production-only", bounded: true };
    try {
      const result = z
        .object({
          records: z
            .array(
              z.object({
                Id: sfId,
                SandboxName: z.string(),
                Description: z.string().nullable(),
                LicenseType: z.string().nullable(),
              }),
            )
            .max(100),
          done: z.boolean(),
        })
        .parse(
          await directRequest(
            this.cli,
            org,
            "/services/data/v67.0/tooling/query?q=" +
              encodeURIComponent(
                "SELECT Id,SandboxName,Description,LicenseType FROM SandboxInfo ORDER BY SandboxName LIMIT 100",
              ),
          ),
        );
      return {
        org: publicOrg(org),
        sandboxes: result.records.map((s) => ({
          ...s,
          connected: false,
          loginOrigin: "https://test.salesforce.com",
        })),
        availability: "available",
        bounded: true,
      };
    } catch {
      return {
        org: publicOrg(org),
        sandboxes: [],
        availability: "unavailable",
        message:
          "Sandbox inventory needs production API permissions. Connect a known sandbox separately.",
        bounded: true,
      };
    }
  }
}
export class OrgService extends Context.Service<OrgService, { readonly orgs: OrgManager }>()(
  "t3/headful/OrgService",
) {}
const make = Effect.gen(function* () {
  const { store } = yield* Store.Store;
  const { cli } = yield* SalesforceCli.SalesforceCli;
  return OrgService.of({ orgs: new OrgManager(store, cli) });
});
export const layer = Layer.effect(OrgService, make);
