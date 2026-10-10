import { z } from "zod";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Store from "./Store.ts";
import * as FeatureService from "./FeatureService.ts";
import * as SalesforceCli from "./SalesforceCli.ts";
import { canonicalIdentity, publicOrg } from "./OrgService.ts";
import { requireOrg } from "./domain/salesforce.ts";
import { scope } from "./domain/workflows.ts";
import { now, random } from "./domain/security.ts";
import { HttpError, type Org, type Principal } from "./domain/types.ts";
import { boundedSoql, readOnlySoql } from "./utilities/soql.ts";
import {
  headfulUtilityInputSchemas,
  headfulUtilityResultSchemas,
  utilityApiNameSchema,
  utilityCellSchema,
  utilityOperationPolicies,
  utilitySavedQuerySchema,
  utilityFavoriteSchema,
  workspacePreferencesSchema,
  type HeadfulUtilityOperation,
} from "../../../../packages/contracts/src/headful-utilities.ts";

type Handlers = {
  [K in HeadfulUtilityOperation]: (
    input: z.output<(typeof headfulUtilityInputSchemas)[K]>,
    principal: Principal,
  ) => Promise<unknown>;
};
const envelope = z.object({
  records: z.array(z.record(z.string(), z.json())).max(501),
  totalSize: z.number().int().nonnegative().optional(),
  done: z.boolean().optional(),
});
const rawDescribe = z.object({
  name: utilityApiNameSchema,
  label: z.string(),
  labelPlural: z.string().optional(),
  keyPrefix: z.string().nullable().optional(),
  queryable: z.boolean().default(false),
  searchable: z.boolean().default(false),
  custom: z.boolean().default(false),
  fields: z
    .array(
      z.object({
        name: utilityApiNameSchema,
        label: z.string(),
        type: z.string(),
        length: z.number().int().nonnegative().optional(),
        nillable: z.boolean().default(true),
        createable: z.boolean().default(false),
        updateable: z.boolean().default(false),
        calculated: z.boolean().default(false),
        calculatedFormula: z.string().max(20000).nullable().default(null),
        referenceTo: z.array(utilityApiNameSchema).default([]),
        relationshipName: z.string().nullable().default(null),
        picklistValues: z
          .array(
            z.object({
              label: z.string(),
              value: z.string(),
              active: z.boolean().default(false),
              defaultValue: z.boolean().default(false),
            }),
          )
          .default([]),
      }),
    )
    .max(5000),
  childRelationships: z
    .array(
      z.object({
        childSObject: utilityApiNameSchema,
        field: utilityApiNameSchema.nullable(),
        relationshipName: z.string().nullable().default(null),
        cascadeDelete: z.boolean().default(false),
      }),
    )
    .max(5000)
    .default([]),
});
const owner = (principal: Principal) =>
  principal.kind === "desktop" ? `desktop:${principal.user.id}` : `mcp:${principal.grantId ?? ""}`;
const destinationPaths = {
  home: "/lightning/page/home",
  setup: "/lightning/setup/SetupOneHome/home",
  users: "/lightning/setup/ManageUsers/home",
  "permission-sets": "/lightning/setup/PermSets/home",
  "object-manager": "/lightning/setup/ObjectManager/home",
} as const;

function flatten(raw: Record<string, z.infer<ReturnType<typeof z.json>>>) {
  const result: Record<string, z.output<typeof utilityCellSchema>> = Object.create(null);
  const visit = (value: z.infer<ReturnType<typeof z.json>>, path: string, depth: number) => {
    if (Object.keys(result).length > 1000 || depth > 8)
      throw new HttpError(
        502,
        "query_shape_bound",
        "The result contains too many nested fields. Select fewer fields.",
      );
    if (value === null || typeof value !== "object") {
      result[path] = utilityCellSchema.parse(value);
      return;
    }
    if (Array.isArray(value) || Object.hasOwn(value, "records")) {
      result[path] = utilityCellSchema.parse(JSON.stringify(value));
      return;
    }
    for (const [key, nested] of Object.entries(value))
      if (key !== "attributes" && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key))
        visit(nested, path ? `${path}.${key}` : key, depth + 1);
  };
  visit(raw, "", 0);
  return result;
}
export class UtilityManager {
  readonly handlers: Handlers;
  private readonly store: Store.LocalStore;
  private readonly cli: SalesforceCli.CliAdapter;
  private readonly features: FeatureService.FeatureManager;
  private readonly active = new Map<
    string,
    { orgId: string; owner: string; controller: AbortController }
  >();
  private closed = false;
  constructor(
    store: Store.LocalStore,
    cli: SalesforceCli.CliAdapter,
    features: FeatureService.FeatureManager,
  ) {
    this.store = store;
    this.cli = cli;
    this.features = features;
    this.handlers = {
      "utilities.backup.location": async (i, p) => {
        const org = await this.verified(i.orgId, p);
        const url = new URL("https://headful.cloud/backup");
        url.searchParams.set("sourceOrg", org.salesforce_org_id);
        return { url: url.toString(), executor: "cloud", cloudAuthorization: "required" };
      },
      "utilities.record.get": async (i, p) => {
        const org = await this.verified(i.orgId, p),
          describe = rawDescribe.parse(await this.cli.utilityDescribe(org.username, i.object));
        if (describe.name.toLowerCase() !== i.object.toLowerCase())
          throw new HttpError(
            502,
            "schema_identity",
            "Salesforce returned another object description.",
          );
        const record = z
          .record(z.string(), z.json())
          .parse(await this.cli.utilityRecord(org.username, i.object, i.recordId));
        if (
          typeof record.Id !== "string" ||
          canonicalIdentity(record.Id) !== canonicalIdentity(i.recordId)
        )
          throw new HttpError(
            502,
            "record_identity",
            "Salesforce did not return the selected record.",
          );
        return {
          org: publicOrg(org),
          object: describe.name,
          recordId: i.recordId,
          fields: describe.fields
            .filter((field) => Object.hasOwn(record, field.name))
            .map((field) => ({
              name: field.name,
              label: field.label,
              type: field.type,
              value: utilityCellSchema.parse(
                typeof record[field.name] === "object" && record[field.name] !== null
                  ? JSON.stringify(record[field.name])
                  : record[field.name],
              ),
            })),
          bounded: true,
        };
      },
      "utilities.query.run": async (i, p) => this.query(i, p),
      "utilities.query.cancel": async (i, p) => {
        await this.localOrg(i.orgId, p);
        const key = this.requestKey(p, i.orgId, i.requestId),
          job = this.active.get(key);
        job?.controller.abort();
        return { requestId: i.requestId, cancelled: Boolean(job) };
      },
      "utilities.objects.list": async (i, p) => {
        const org = await this.verified(i.orgId, p),
          names = z
            .array(utilityApiNameSchema)
            .max(5000)
            .parse(await this.cli.utilityObjects(org.username, i.category));
        return {
          org: publicOrg(org),
          objects: names.map((name) => ({ name, custom: /__(?:c|mdt|e|b|x)$/.test(name) })),
          bounded: true,
        };
      },
      "utilities.objects.describe": async (i, p) => {
        const org = await this.verified(i.orgId, p),
          description = rawDescribe.parse(await this.cli.utilityDescribe(org.username, i.object));
        if (description.name.toLowerCase() !== i.object.toLowerCase())
          throw new HttpError(
            502,
            "schema_identity",
            "Salesforce returned another object description.",
          );
        return {
          org: publicOrg(org),
          ...description,
          labelPlural: description.labelPlural ?? description.label,
          keyPrefix: description.keyPrefix ?? null,
          fields: description.fields.map((field) => ({ ...field, length: field.length ?? null })),
          childRelationships: description.childRelationships.filter(
            (relationship) => relationship.field !== null,
          ),
          bounded: true,
        };
      },
      "utilities.diagnostics": async (i, p) => {
        const org = await this.verified(i.orgId, p),
          limits: Array<{ name: string; max: number; remaining: number }> = [],
          jobs: Array<{
            id: string;
            type: string;
            status: string;
            createdAt: string | null;
            completedAt: string | null;
            processed: number;
            total: number;
            errors: number;
          }> = [],
          messages: string[] = [];
        try {
          limits.push(
            ...z
              .array(
                z.object({
                  name: z.string(),
                  max: z.number().nonnegative(),
                  remaining: z.number().nonnegative(),
                }),
              )
              .max(500)
              .parse(await this.cli.utilityLimits(org.username)),
          );
        } catch {
          messages.push(
            "CLI limits are unavailable. Check org permissions and the installed Salesforce CLI.",
          );
        }
        try {
          const raw = envelope.parse(
            await this.cli.utilityQuery(
              org.username,
              "SELECT Id,JobType,Status,CreatedDate,CompletedDate,JobItemsProcessed,TotalJobItems,NumberOfErrors FROM AsyncApexJob ORDER BY CreatedDate DESC LIMIT 100",
            ),
          );
          const job = z.object({
            Id: z.string(),
            JobType: z.string(),
            Status: z.string(),
            CreatedDate: z.string().nullable(),
            CompletedDate: z.string().nullable(),
            JobItemsProcessed: z.number().int().nonnegative(),
            TotalJobItems: z.number().int().nonnegative(),
            NumberOfErrors: z.number().int().nonnegative(),
          });
          for (const row of raw.records) {
            const j = job.parse(row);
            jobs.push({
              id: j.Id,
              type: j.JobType,
              status: j.Status,
              createdAt: j.CreatedDate,
              completedAt: j.CompletedDate,
              processed: j.JobItemsProcessed,
              total: j.TotalJobItems,
              errors: j.NumberOfErrors,
            });
          }
        } catch {
          messages.push(
            "Recent Apex jobs are unavailable. This connection may not have permission to inspect jobs.",
          );
        }
        return {
          org: publicOrg(org),
          limits,
          storage: limits
            .filter((limit) => ["DataStorageMB", "FileStorageMB"].includes(limit.name))
            .map((limit) => ({ ...limit, unit: "MB" })),
          jobs,
          messages,
          bounded: true,
        };
      },
      "utilities.logs.list": async (i, p) => {
        const org = await this.verified(i.orgId, p),
          raw = z
            .array(
              z.object({
                Id: z.string(),
                StartTime: z.string().nullable().optional(),
                Operation: z.string().nullable().optional(),
                Status: z.string().nullable().optional(),
                LogLength: z.number().int().nonnegative(),
                DurationMilliseconds: z.number().nonnegative().nullable().optional(),
                LogUserId: z.string().nullable().optional(),
              }),
            )
            .max(10000)
            .parse(await this.cli.utilityLogs(org.username));
        return {
          org: publicOrg(org),
          logs: raw.slice(0, 100).map((log) => ({
            id: log.Id,
            startTime: log.StartTime ?? null,
            operation: log.Operation ?? null,
            status: log.Status ?? null,
            length: log.LogLength,
            durationMs: log.DurationMilliseconds ?? null,
            userId: log.LogUserId ?? null,
          })),
          bounded: true,
        };
      },
      "utilities.logs.get": async (i, p) => {
        const org = await this.verified(i.orgId, p),
          raw = z
            .array(z.object({ log: z.string().max(1000000) }))
            .max(1)
            .parse(await this.cli.utilityLog(org.username, i.logId));
        if (!raw[0])
          throw new HttpError(
            404,
            "log_missing",
            "This debug log is unavailable to the selected connection.",
          );
        const body = raw[0].log
          .replace(/\b00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?![A-Za-z0-9._-]{20,}\b/g, "[REDACTED]")
          .replace(/(authorization\s*:\s*bearer\s+)[A-Za-z0-9!._-]+/gi, "$1[REDACTED]")
          .replace(
            /((?:access|refresh)[_-]?token|client[_-]?secret|session[_-]?id)(["']?\s*[:=]\s*["']?)[A-Za-z0-9!._-]{12,}/gi,
            "$1$2[REDACTED]",
          );
        return { org: publicOrg(org), logId: i.logId, body, bounded: true };
      },
      "utilities.org.open": async (i, p) => {
        const org = await this.verified(i.orgId, p);
        if (i.destination === "record" && !i.recordId)
          throw new HttpError(400, "record_required", "Choose a record ID for this destination.");
        return this.cli.utilityOpen(
          org.username,
          i.destination === "record" ? `/${i.recordId!}` : destinationPaths[i.destination],
        );
      },
      "utilities.saved.list": async (i, p) => {
        await this.localOrg(i.orgId, p);
        return { queries: this.saved(i.orgId) };
      },
      "utilities.saved.set": async (i, p) => {
        await this.localOrg(i.orgId, p);
        readOnlySoql(i.query);
        const queries = this.saved(i.orgId),
          entry = utilitySavedQuerySchema.parse({
            id: i.id ?? `query_${random().slice(0, 24)}`,
            orgId: i.orgId,
            name: i.name,
            query: i.query,
            updatedAt: now(),
          });
        if (i.id && !queries.some((saved) => saved.id === i.id))
          throw new HttpError(
            404,
            "saved_query_missing",
            "This saved query does not belong to the selected org.",
          );
        const next = [entry, ...queries.filter((saved) => saved.id !== entry.id)];
        if (next.length > 100)
          throw new HttpError(
            409,
            "saved_query_bound",
            "Remove a saved query before adding more than 100 for this org.",
          );
        this.store.setPreference(`utilities:${i.orgId}:queries`, next);
        return entry;
      },
      "utilities.saved.remove": async (i, p) => {
        await this.localOrg(i.orgId, p);
        const current = this.saved(i.orgId),
          next = current.filter((entry) => entry.id !== i.id);
        this.store.setPreference(`utilities:${i.orgId}:queries`, next);
        return { removed: next.length !== current.length };
      },
      "utilities.history.list": async (i, p) => {
        await this.localOrg(i.orgId, p);
        return { history: this.history(i.orgId) };
      },
      "utilities.favorites.list": async (i, p) => {
        await this.localOrg(i.orgId, p);
        return { favorites: this.favorites(i.orgId) };
      },
      "utilities.favorites.set": async (i, p) => {
        await this.localOrg(i.orgId, p);
        if (i.destination === "record" && !i.recordId)
          throw new HttpError(400, "record_required", "Choose a record ID for this favorite.");
        const current = this.favorites(i.orgId),
          entry = utilityFavoriteSchema.parse({
            ...i,
            id: i.id ?? `favorite_${random().slice(0, 24)}`,
          });
        if (i.id && !current.some((favorite) => favorite.id === i.id))
          throw new HttpError(
            404,
            "favorite_missing",
            "This favorite does not belong to the selected org.",
          );
        const next = [entry, ...current.filter((favorite) => favorite.id !== entry.id)];
        if (next.length > 50)
          throw new HttpError(
            409,
            "favorite_bound",
            "Remove a favorite before adding more than 50 for this org.",
          );
        this.store.setPreference(`utilities:${i.orgId}:favorites`, next);
        return entry;
      },
      "utilities.favorites.remove": async (i, p) => {
        await this.localOrg(i.orgId, p);
        const current = this.favorites(i.orgId),
          next = current.filter((entry) => entry.id !== i.id);
        this.store.setPreference(`utilities:${i.orgId}:favorites`, next);
        return { removed: next.length !== current.length };
      },
      "preferences.get": async () => ({
        workspace: workspacePreferencesSchema.parse(
          this.store.preference("workspacePreferences", {
            global: { order: [], hidden: [] },
            overrides: {},
          }),
        ),
      }),
      "preferences.set": async (i) => {
        this.store.setPreference("workspacePreferences", i.workspace);
        return i;
      },
    };
    // All transports use these wrappers; direct desktop calls cannot bypass mod gates.
    this.handlers = Object.fromEntries(
      (Object.keys(this.handlers) as HeadfulUtilityOperation[]).map((operation) => {
        const handler = this.handlers[operation] as (
          input: z.output<(typeof headfulUtilityInputSchemas)[HeadfulUtilityOperation]>,
          principal: Principal,
        ) => Promise<unknown>;
        return [
          operation,
          async (
            input: z.output<(typeof headfulUtilityInputSchemas)[HeadfulUtilityOperation]>,
            principal: Principal,
          ) => {
            this.authorize(operation, principal);
            const result = await handler(input, principal);
            this.authorize(operation, principal);
            return result;
          },
        ];
      }),
    ) as Handlers;
  }
  private authorize(operation: HeadfulUtilityOperation, principal: Principal) {
    if (this.closed)
      throw new HttpError(503, "utilities_closed", "Headful utilities have stopped.");
    const policy = utilityOperationPolicies[operation];
    if (policy.desktopOnly && principal.kind !== "desktop")
      throw new HttpError(
        403,
        "desktop_required",
        "Manage this local preference or destination in Headful.",
      );
    if (policy.feature) this.features.require(policy.feature);
    if (principal.kind === "mcp") {
      scope(principal, "headful:read");
      if (policy.scope) scope(principal, policy.scope);
    }
  }
  private localOrg(id: string, principal: Principal) {
    return requireOrg({ DB: this.store, cli: this.cli }, principal, id);
  }
  private async verified(id: string, principal: Principal, signal?: AbortSignal): Promise<Org> {
    const org = await this.localOrg(id, principal),
      identity = await this.cli.utilityIdentity(org.username, signal);
    if (
      canonicalIdentity(identity.orgId) !== canonicalIdentity(org.salesforce_org_id) ||
      canonicalIdentity(identity.userId) !== canonicalIdentity(org.salesforce_user_id) ||
      identity.username !== org.username ||
      identity.instanceOrigin !== org.instance_origin
    )
      throw new HttpError(
        409,
        "identity_changed",
        "The CLI authenticated org or user changed. Reconnect this exact org in Headful.",
      );
    return org;
  }
  private requestKey(principal: Principal, orgId: string, requestId: string) {
    return `${owner(principal)}:${orgId}:${requestId}`;
  }
  private async query(
    input: z.output<(typeof headfulUtilityInputSchemas)["utilities.query.run"]>,
    principal: Principal,
  ) {
    await this.localOrg(input.orgId, principal);
    const bounded = boundedSoql(input.query, input.page, input.pageSize),
      key = this.requestKey(principal, input.orgId, input.requestId),
      currentOwner = owner(principal),
      started = now();
    if (this.active.has(key))
      throw new HttpError(409, "query_running", "This query request is already running.");
    if (
      this.active.size >= 8 ||
      [...this.active.values()].filter((job) => job.owner === currentOwner).length >= 2
    )
      throw new HttpError(
        429,
        "query_concurrency",
        "Finish or cancel a running query before starting another.",
      );
    const controller = new AbortController();
    this.active.set(key, { orgId: input.orgId, owner: currentOwner, controller });
    let status: "success" | "error" | "cancelled" = "error",
      returned = 0;
    try {
      const org = await this.verified(input.orgId, principal, controller.signal),
        raw = envelope.parse(
          await this.cli.utilityQuery(org.username, bounded.query, controller.signal),
        );
      if (raw.records.length > bounded.limit)
        throw new HttpError(
          502,
          "query_record_bound",
          "The CLI returned more records than this bounded query requested.",
        );
      const records = raw.records.slice(0, input.pageSize).map(flatten),
        names = [...new Set(records.flatMap((record) => Object.keys(record)))];
      if (names.length > 1000)
        throw new HttpError(
          502,
          "query_shape_bound",
          "The result contains too many columns. Select fewer fields.",
        );
      returned = records.length;
      status = "success";
      return {
        org: publicOrg(org),
        requestId: input.requestId,
        query: input.query,
        page: input.page,
        pageSize: input.pageSize,
        columns: names.map((name) => {
          const value = records.find(
            (record) => record[name] !== null && record[name] !== undefined,
          )?.[name];
          return { name, label: name, type: value === undefined ? "unknown" : typeof value };
        }),
        records,
        returned,
        hasMore: raw.records.length > input.pageSize && bounded.canPage,
        bounded: true,
        elapsedMs: Math.max(0, now() - started),
        ...(!bounded.canPage && raw.records.length > input.pageSize
          ? {
              message:
                "This workspace's 2,000-row offset bound was reached. Refine the query to retrieve another slice.",
            }
          : {}),
      };
    } catch (error) {
      if (controller.signal.aborted) {
        status = "cancelled";
        throw new HttpError(409, "query_cancelled", "This query was cancelled.");
      }
      throw error;
    } finally {
      this.active.delete(key);
      if (!this.closed) {
        const history = this.history(input.orgId).filter((entry) => entry.id !== input.requestId);
        this.store.setPreference(
          `utilities:${input.orgId}:history`,
          [
            {
              id: input.requestId,
              orgId: input.orgId,
              query: input.query,
              createdAt: started,
              returned,
              status,
              elapsedMs: Math.max(0, now() - started),
            },
            ...history,
          ].slice(0, 100),
        );
      }
    }
  }
  private saved(orgId: string) {
    return z
      .array(utilitySavedQuerySchema)
      .max(100)
      .parse(this.store.preference(`utilities:${orgId}:queries`, []))
      .filter((entry) => entry.orgId === orgId);
  }
  private favorites(orgId: string) {
    return z
      .array(utilityFavoriteSchema)
      .max(50)
      .parse(this.store.preference(`utilities:${orgId}:favorites`, []))
      .filter((entry) => entry.orgId === orgId);
  }
  private history(orgId: string) {
    return headfulUtilityResultSchemas["utilities.history.list"]
      .parse({ history: this.store.preference(`utilities:${orgId}:history`, []) })
      .history.filter((entry) => entry.orgId === orgId);
  }
  cancelUnavailable() {
    if (!this.features.enabled("headful.admin-utilities/soql"))
      for (const job of this.active.values()) job.controller.abort();
  }
  close() {
    this.closed = true;
    for (const job of this.active.values()) job.controller.abort();
  }
}
export class UtilityService extends Context.Service<
  UtilityService,
  { readonly utilities: UtilityManager }
>()("t3/headful/UtilityService") {}
export const layer = (utilities: UtilityManager) =>
  Layer.succeed(UtilityService, UtilityService.of({ utilities }));
