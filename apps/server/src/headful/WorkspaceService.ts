import type { HeadfulAgentRunnerFactory } from "../../../../packages/contracts/src/headful-agent.ts";
import { utilityOperationPolicies } from "../../../../packages/contracts/src/headful-utilities.ts";
import { z } from "zod";
import { OrgInsights } from "./OrgInsights.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Store from "./Store.ts";
import * as SalesforceCli from "./SalesforceCli.ts";
import * as OrgService from "./OrgService.ts";
import * as FeatureService from "./FeatureService.ts";
import * as UtilityService from "./UtilityService.ts";
import * as ModService from "./mods/ModManager.ts";
import type {
  HeadfulModDefinition,
  HeadfulModPaths,
} from "../../../../packages/contracts/src/headful-mods.ts";
import {
  headfulInputSchemas,
  headfulResultSchemas,
  type HeadfulAuthority,
  type HeadfulOperation,
  type HeadfulResult,
} from "../../../../packages/contracts/src/headful.ts";
import * as sf from "./domain/salesforce.ts";
import * as users from "./domain/users.ts";
import * as permissions from "./domain/permissions.ts";
import { scope } from "./domain/workflows.ts";
import { getLead } from "./domain/lead-service.ts";
import { HttpError, type Env, type Principal } from "./domain/types.ts";

type Handlers = {
  [K in HeadfulOperation]: (
    input: z.output<(typeof headfulInputSchemas)[K]>,
    principal: Principal,
  ) => Promise<unknown>;
};
export class HeadfulServiceError extends Schema.TaggedError<HeadfulServiceError>()(
  "HeadfulServiceError",
  { code: Schema.String, status: Schema.Number, detail: Schema.String },
) {
  override get message() {
    return this.detail;
  }
}
export interface HeadfulRuntime {
  readonly store: Store.LocalStore;
  readonly mods: ModService.ModManager;
  dispatch<K extends HeadfulOperation>(
    operation: K,
    input: unknown,
    authority: HeadfulAuthority,
  ): Promise<HeadfulResult<K>>;
  close(): Promise<void>;
}
const desktopOnly = (principal: Principal) => {
  if (principal.kind !== "desktop")
    throw new HttpError(
      403,
      "desktop_required",
      "This action requires the Headful desktop interface.",
    );
};
const workspaceScope = (principal: Principal, required = "headful:read") =>
  scope(principal, required);

export function makeHeadfulRuntime(options: {
  homeDir: string;
  cli?: SalesforceCli.CliAdapter;
  store?: Store.LocalStore;
  mods?: readonly HeadfulModDefinition[];
  modHost?: HeadfulModPaths;
  agentRunner?: HeadfulAgentRunnerFactory;
}): HeadfulRuntime {
  const store = options.store ?? new Store.LocalStore(options.homeDir);
  const cli =
    options.cli ?? new SalesforceCli.CliAdapter(store.preference<string | null>("cliPath", null));
  const orgs = new OrgService.OrgManager(store, cli),
    features = new FeatureService.FeatureManager(store);
  const env: Env = { DB: store, cli };
  const insights = new OrgInsights(cli);
  const utilities = new UtilityService.UtilityManager(store, cli, features);
  let closed = false;
  let closing: Promise<void> | undefined;
  // Mod lifecycle hooks already run inside the manager's serialized queue.
  // Their restricted core port must not wait on that same initialization queue.
  const mods = new ModService.ModManager({
    store,
    features,
    runtime: {
      dispatch: (operation, input, authority) => dispatch(operation, input, authority, true),
    },
    paths: {
      ...(options.modHost ?? { homeDir: options.homeDir }),
      salesforceCli: store.preference<string | null>("cliPath", null) ?? "sf",
    },
    definitions: options.mods ?? [],
    ...(options.agentRunner ? { agentRunner: options.agentRunner } : {}),
  });
  const handlers: Handlers = {
    ...utilities.handlers,
    "mods.api": async (i, p) => {
      desktopOnly(p);
      return mods.api(i.id, i.api, i.input);
    },
    "mods.list": async (_, p) => {
      desktopOnly(p);
      return mods.list();
    },
    "mods.inspect": async (i, p) => {
      desktopOnly(p);
      return mods.inspect(i.id);
    },
    "mods.enable": async (i, p) => {
      desktopOnly(p);
      return mods.enable(i.id);
    },
    "mods.disable": async (i, p) => {
      desktopOnly(p);
      const disabling = mods.disable(i.id);
      utilities.cancelUnavailable();
      return disabling;
    },
    "mods.settings": async (i, p) => {
      desktopOnly(p);
      return mods.settings(i.id);
    },
    "mods.settings.set": async (i, p) => {
      desktopOnly(p);
      return mods.setSettings(i.id, i.values);
    },
    "mods.command": async (i, p) => {
      desktopOnly(p);
      return mods.command(i.id, i.command, i.input, i.artifactRevision);
    },
    "mods.surface": async (i, p) => {
      desktopOnly(p);
      return mods.surface(i.id, i.surfaceId, i.artifactRevision);
    },
    status: async (_, p) => {
      const state = orgs.list();
      return {
        product: "Headful",
        protocol: "headful-local-v1",
        local: true,
        accountRequired: false,
        ...state,
        orgs: state.orgs.filter(
          (o) =>
            p.kind === "desktop" ||
            ((p.source === "connect" ? o.remoteEnabled : o.agentEnabled) &&
              p.orgIds?.includes(o.id)),
        ),
        defaultOrgId:
          p.kind === "desktop" ||
          state.orgs.some(
            (o) =>
              o.id === state.defaultOrgId &&
              (p.source === "connect" ? o.remoteEnabled : o.agentEnabled) &&
              p.orgIds?.includes(o.id),
          )
            ? state.defaultOrgId
            : null,
        ...features.list(),
      };
    },
    "cli.detect": async (_, p) => {
      desktopOnly(p);
      return cli.detect();
    },
    "cli.configure": async (i, p) => {
      desktopOnly(p);
      const result = await cli.configure(i.path);
      store.setPreference("cliPath", i.path);
      return result;
    },
    "orgs.list": async (_, p) => {
      desktopOnly(p);
      return orgs.list();
    },
    "orgs.discover": async (_, p) => {
      desktopOnly(p);
      return cli.discover();
    },
    "orgs.import": async (i, p) => {
      desktopOnly(p);
      features.require("org-management");
      return orgs.import(i.username, i);
    },
    "orgs.login": async (i, p) => {
      desktopOnly(p);
      features.require("org-management");
      const login = await cli.login(i);
      return orgs.import(login.username, {
        reconnect: true,
        ...(i.alias ? { alias: i.alias } : {}),
      });
    },
    "orgs.update": async (i, p) => {
      desktopOnly(p);
      features.require("org-management");
      const result = orgs.update(i.orgId, i);
      await mods.publishEvent({ type: "org-policy-changed", orgId: i.orgId });
      return result;
    },
    "orgs.default": async (i, p) => {
      desktopOnly(p);
      features.require("org-management");
      const result = orgs.setDefault(i.orgId);
      await mods.publishEvent({ type: "default-org-changed", orgId: i.orgId });
      return result;
    },
    "orgs.remove": async (i, p) => {
      desktopOnly(p);
      features.require("org-management");
      const result = orgs.remove(i.orgId);
      await mods.publishEvent({ type: "org-policy-changed", orgId: i.orgId });
      return result;
    },
    "orgs.health": async (i, p) => {
      workspaceScope(p);
      await sf.requireOrg(env, p, i.orgId);
      return orgs.health(i.orgId);
    },
    "orgs.open": async (i, p) => {
      desktopOnly(p);
      const org = await sf.requireOrg(env, p, i.orgId);
      return cli.open(org.username);
    },
    "orgs.logout": async (i, p) => {
      desktopOnly(p);
      const org = orgs.get(i.orgId);
      await cli.logout(org.username);
      const result = orgs.remove(i.orgId);
      await mods.publishEvent({ type: "org-policy-changed", orgId: i.orgId });
      return result;
    },
    "orgs.sandboxes": async (i, p) => {
      workspaceScope(p);
      await sf.requireOrg(env, p, i.orgId);
      return orgs.sandboxes(i.orgId);
    },
    "orgs.overview": async (i, p) => {
      workspaceScope(p);
      features.require("org-management");
      return insights.overview(await sf.requireOrg(env, p, i.orgId));
    },
    "orgs.limits": async (i, p) => {
      workspaceScope(p);
      features.require("org-management");
      return insights.limits(await sf.requireOrg(env, p, i.orgId));
    },
    "orgs.licenses": async (i, p) => {
      workspaceScope(p);
      features.require("org-management");
      return insights.licenses(await sf.requireOrg(env, p, i.orgId));
    },
    "orgs.metadata": async (i, p) => {
      workspaceScope(p);
      features.require("org-management");
      return insights.metadata(await sf.requireOrg(env, p, i.orgId));
    },
    "orgs.metadata.components": async (i, p) => {
      workspaceScope(p);
      features.require("org-management");
      return insights.components(await sf.requireOrg(env, p, i.orgId), i.type, i.folder);
    },
    "orgs.environments": async (i, p) => {
      workspaceScope(p);
      features.require("org-management");
      return insights.environments(await sf.requireOrg(env, p, i.orgId));
    },
    "features.list": async (_, p) => {
      desktopOnly(p);
      return features.list();
    },
    "features.set": async (i, p) => {
      desktopOnly(p);
      features.set(i.id, i.enabled);
      utilities.cancelUnavailable();
      await mods.featureChanged(i.id, i.enabled);
      await mods.publishEvent({ type: "feature-changed", id: i.id, enabled: i.enabled });
      return features.list();
    },
    "onboarding.complete": async (i, p) => {
      desktopOnly(p);
      store.setPreference("onboardingComplete", true);
      store.setPreference("onboardingMode", i.mode);
      return features.list();
    },
    "activity.list": async (_, p) => {
      desktopOnly(p);
      features.require("reviewed-changes");
      return {
        activity: store.db
          .prepare("SELECT * FROM activity ORDER BY created_at DESC LIMIT 100")
          .all(),
        bounded: true,
      };
    },
    listOrgs: async (_, p) => {
      features.require("org-management");
      workspaceScope(p);
      const rows = orgs
        .rows()
        .filter(
          (o) =>
            p.kind === "desktop" ||
            ((p.source === "connect" ? orgs.remoteEnabled(o.id) : Boolean(o.agent_enabled)) &&
              p.orgIds?.includes(o.id)),
        );
      return { orgs: rows.map(OrgService.publicOrg) };
    },
    listLeads: async (i, p) => {
      workspaceScope(p);
      const org = await sf.requireOrg(env, p, i.orgId);
      return sf.leads(env, org, i.search, i.limit, i.page);
    },
    inspectLead: async (i, p) => {
      workspaceScope(p);
      return getLead(env, p, i);
    },
    listPermissionSets: async (i, p) => {
      workspaceScope(p);
      workspaceScope(p, "headful:permissions");
      const org = await sf.requireOrg(env, p, i.orgId);
      return sf.permissionSets(env, org, i.search);
    },
    inspectPermissionSet: async (i, p) => {
      workspaceScope(p);
      workspaceScope(p, "headful:permissions");
      const org = await sf.requireOrg(env, p, i.orgId);
      return sf.permissionDetail(env, org, i.permissionSetId);
    },
    preparePermissionChange: async (i, p) => {
      features.require("reviewed-changes");
      workspaceScope(p, "headful:permissions");
      return permissions.prepareChange(env, p, permissions.proposalInput.parse(i));
    },
    getPermissionProposal: async (i, p) => {
      workspaceScope(p, "headful:permissions");
      const proposal = await permissions.getProposal(env, p.user.id, i.proposalId);
      await sf.requireOrg(env, p, proposal.orgId);
      return proposal;
    },
    reviewPermissionProposal: async (i, p) => {
      desktopOnly(p);
      features.require("reviewed-changes");
      const proposal = await permissions.getProposal(env, p.user.id, i.proposalId);
      if (proposal.digest !== i.digest)
        throw new HttpError(409, "review_stale", "Review the current proposal.");
      const { proposal: _proposal, ...review } = await permissions.issuePermissionReview(
        env,
        p,
        i.proposalId,
      );
      return review;
    },
    applyPermissionProposal: async (i, p) => {
      desktopOnly(p);
      features.require("reviewed-changes");
      await permissions.executePermissionReview(env, p, i);
      return permissions.getProposal(env, p.user.id, i.proposalId);
    },
    rejectPermissionProposal: async (i, p) => {
      desktopOnly(p);
      const proposal = await permissions.getProposal(env, p.user.id, i.proposalId);
      await sf.requireOrg(env, p, proposal.orgId);
      const result = await store
        .prepare(
          "UPDATE proposals SET status='rejected' WHERE id=? AND digest=? AND status='pending'",
        )
        .bind(i.proposalId, i.digest)
        .run();
      if (result.meta.changes !== 1)
        throw new HttpError(
          409,
          "proposal_unavailable",
          "The exact proposal is no longer pending.",
        );
      return { status: "rejected" };
    },
    listUsers: async (i, p) => users.listUsers(env, p, i),
    inspectUser: async (i, p) => users.inspectUser(env, p, i),
    inspectUserAccess: async (i, p) => users.userAccess(env, p, i),
    listWorkflows: async (_, p) => users.listWorkflows(env, p),
    prepareUserCreation: async (i, p) => {
      features.require("reviewed-changes");
      return users.prepareUserCreation(env, p, i);
    },
    getWorkflow: async (i, p) => users.getWorkflow(env, p, i.workflowId),
    saveUserDraft: async (i, p) => {
      features.require("reviewed-changes");
      return users.saveUserDraft(env, p, i);
    },
    reviewWorkflow: async (i, p) => {
      desktopOnly(p);
      features.require("reviewed-changes");
      return users.workflowReview(env, p, i);
    },
    createUser: async (i, p) => {
      desktopOnly(p);
      features.require("reviewed-changes");
      return users.approveUserCreation(env, p, i);
    },
    reconcileUser: async (i, p) => users.reconcileUserCreation(env, p, i.workflowId),
    getUserAccess: async (i, p) => users.workflowAccess(env, p, i.workflowId),
    prepareUserAccess: async (i, p) => {
      features.require("reviewed-changes");
      return users.prepareAccessChange(env, p, i);
    },
    applyUserAccess: async (i, p) => {
      desktopOnly(p);
      features.require("reviewed-changes");
      return users.applyAccessChange(env, p, i);
    },
    reconcileAccess: async (i, p) => users.reconcileAccess(env, p, i.workflowId),
  };
  const workspaceOperations = new Set<HeadfulOperation>([
    "listLeads",
    "inspectLead",
    "listPermissionSets",
    "inspectPermissionSet",
    "preparePermissionChange",
    "getPermissionProposal",
    "reviewPermissionProposal",
    "applyPermissionProposal",
    "rejectPermissionProposal",
    "listUsers",
    "inspectUser",
    "inspectUserAccess",
    "listWorkflows",
    "prepareUserCreation",
    "getWorkflow",
    "saveUserDraft",
    "reviewWorkflow",
    "createUser",
    "reconcileUser",
    "getUserAccess",
    "prepareUserAccess",
    "applyUserAccess",
    "reconcileAccess",
  ]);
  async function dispatch<K extends HeadfulOperation>(
    operation: K,
    input: unknown,
    authority: HeadfulAuthority,
    fromMod = false,
  ): Promise<HeadfulResult<K>> {
    if (closed)
      throw new HttpError(
        503,
        "runtime_closed",
        "Headful is no longer running. Open the app to reconnect.",
      );
    if (!fromMod) {
      await mods.initialize();
      if (Object.hasOwn(utilityOperationPolicies, operation)) {
        const policy = utilityOperationPolicies[operation as keyof typeof utilityOperationPolicies];
        if (policy.feature) await mods.activateFeature(policy.feature);
      }
      if (authority.kind === "mcp")
        await mods.activateFeature(
          authority.source === "connect" ? "headful.connect-desktop/remote-access" : "local-mcp",
        );
    }
    if (!Object.hasOwn(headfulInputSchemas, operation))
      throw new HttpError(404, "operation_unknown", "This Headful operation is unavailable.");
    const decoded = headfulInputSchemas[operation].safeParse(input);
    if (!decoded.success)
      throw new HttpError(
        400,
        "invalid_input",
        "Review the required fields and formats for this action.",
      );
    const parsed = decoded.data;
    if (authority.source === "connect" && authority.kind !== "mcp")
      throw new HttpError(
        403,
        "authority_invalid",
        "Remote transport cannot grant human desktop authority.",
      );
    if (authority.kind === "mcp") {
      if (authority.source === "connect") {
        mods.requireActive("headful.connect-desktop");
        features.require("headful.connect-desktop/remote-access");
      } else {
        features.require("local-mcp");
        features.require("external-harness");
      }
      features.require("org-management");
      if (!authority.clientId || !authority.orgIds || !authority.scopes)
        throw new HttpError(403, "grant_required", "A current local client grant is required.");
    }
    if (authority.kind === "mcp" && !authority.scopes?.includes("headful:read"))
      throw new HttpError(403, "scope", "This local client requires the Salesforce read scope.");
    if (workspaceOperations.has(operation)) features.require("salesforce-workspace");
    const principal: Principal = {
      user: { id: "local-headful-owner" },
      kind: authority.kind,
      ...(authority.source ? { source: authority.source } : {}),
      orgIds:
        authority.kind === "desktop"
          ? null
          : (authority.orgIds ?? []).filter(
              (id) => authority.source !== "connect" || orgs.remoteEnabled(id),
            ),
      scopes:
        authority.kind === "desktop"
          ? [
              "headful:read",
              "headful:propose",
              "headful:users",
              "headful:access",
              "headful:permissions",
              "headful:inspect",
              "headful:query",
              "headful:schema",
              "headful:diagnostics",
            ]
          : (authority.scopes ?? []),
      ...(authority.clientId ? { grantId: authority.clientId } : {}),
    };
    // Each handler has its own exact decoded input; no generic shell/API transport is exposed.
    const handler = handlers[operation] as (
      value: typeof parsed,
      principal: Principal,
    ) => Promise<unknown>;
    try {
      return headfulResultSchemas[operation].parse(
        await handler(parsed, principal),
      ) as HeadfulResult<K>;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof z.ZodError)
        throw new HttpError(
          400,
          "invalid_provider_data",
          "Salesforce returned unsupported data or the proposal does not match this org.",
        );
      throw new HttpError(
        500,
        "local_operation_failed",
        "Headful could not complete this local operation. Check the connection and workflow state.",
      );
    }
  }
  return {
    store,
    dispatch,
    mods,
    close: () => {
      if (closing) return closing;
      closed = true;
      utilities.close();
      cli.close();
      closing = mods.close().finally(() => store.close());
      return closing;
    },
  };
}
export class WorkspaceService extends Context.Service<
  WorkspaceService,
  {
    readonly call: <K extends HeadfulOperation>(
      operation: K,
      input: unknown,
      authority: HeadfulAuthority,
    ) => Effect.Effect<HeadfulResult<K>, HeadfulServiceError>;
  }
>()("t3/headful/WorkspaceService") {}
export const layer = (runtime: HeadfulRuntime) =>
  Layer.succeed(
    WorkspaceService,
    WorkspaceService.of({
      call: (operation, input, authority) =>
        Effect.tryPromise({
          try: () => runtime.dispatch(operation, input, authority),
          catch: (error) =>
            new HeadfulServiceError({
              code: error instanceof HttpError ? error.code : "local_operation_failed",
              status: error instanceof HttpError ? error.status : 500,
              detail:
                error instanceof HttpError
                  ? error.message
                  : "Headful could not complete this operation.",
            }),
        }),
    }),
  );
