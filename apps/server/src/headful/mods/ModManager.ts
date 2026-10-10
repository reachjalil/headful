import type { HeadfulAgentRunnerFactory } from "../../../../../packages/contracts/src/headful-agent.ts";
// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import { compatible } from "./ModArtifact.ts";
import { serializable, validateValue } from "../../../../../packages/mod-sdk/src/schema.ts";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import {
  headfulModApiVersion,
  headfulModManifestSchema,
  headfulModOperations,
  modSettingsSchema,
  modCommandResultSchema,
  modSurfaceResultSchema,
  modStatusValueSchema,
  type HeadfulModStatus,
  type HeadfulModEvent,
  type HeadfulModActivation,
  type HeadfulModContext,
  type HeadfulModDefinition,
  type HeadfulModDescriptor,
  type HeadfulModManifest,
  type HeadfulModPaths,
} from "../../../../../packages/contracts/src/headful-mods.ts";
import type {
  HeadfulAuthority,
  HeadfulOperation,
  HeadfulResult,
} from "../../../../../packages/contracts/src/headful.ts";
import { headfulInputSchemas } from "../../../../../packages/contracts/src/headful.ts";
import {
  utilityOperationPolicies,
  type HeadfulUtilityOperation,
} from "../../../../../packages/contracts/src/headful-utilities.ts";
import * as FeatureService from "../FeatureService.ts";
import * as Store from "../Store.ts";
import { HttpError } from "../domain/types.ts";

type RuntimePort = {
  dispatch<K extends HeadfulOperation>(
    operation: K,
    input: unknown,
    authority: HeadfulAuthority,
  ): Promise<HeadfulResult<K>>;
};
type Entry = {
  definition: HeadfulModDefinition;
  manifest: HeadfulModManifest;
  status: HeadfulModDescriptor["status"];
  error?: HeadfulModDescriptor["error"];
  controller?: AbortController;
  activation?: HeadfulModActivation;
  cleanupFailed?: boolean;
  runtimeStatuses?: Map<string, HeadfulModStatus>;
  registeredCapabilities?: Set<string>;
  listeners?: Set<(event: HeadfulModEvent) => void | Promise<void>>;
};
const permittedOperations = new Set<string>(headfulModOperations);
const desktopReads = new Set<string>(["status", "listOrgs"]);
const nativeSafeOperations = new Set<string>([
  ...desktopReads,
  ...Object.keys(utilityOperationPolicies),
]);
const proposalOperations = new Set<string>([
  "preparePermissionChange",
  "prepareUserCreation",
  "saveUserDraft",
  "prepareUserAccess",
]);

/** The artifact loader supplies metadata and host-owned execution factories.
 * Native code is explicitly trusted; community execution uses the Electron broker. */
export class ModManager {
  private requested = new Set<string>();
  private readonly entries = new Map<string, Entry>();
  private readonly store: Store.LocalStore;
  private readonly features: FeatureService.FeatureManager;
  private readonly runtime: RuntimePort;
  private readonly agentRunner: HeadfulAgentRunnerFactory | undefined;
  private paths: HeadfulModPaths;
  private queue: Promise<void> = Promise.resolve();
  private artifactWrites = new Map<string, Promise<unknown>>();
  private initialized = false;
  private closed = false;
  constructor(options: {
    store: Store.LocalStore;
    features: FeatureService.FeatureManager;
    runtime: RuntimePort;
    agentRunner?: HeadfulAgentRunnerFactory;
    paths: HeadfulModPaths;
    definitions: readonly HeadfulModDefinition[];
  }) {
    this.store = options.store;
    // Preserve only saved local configuration affected by first-party namespace changes.
    const namespace = (value: string) =>
      value.replace(/^(admin-utilities|mcp-apps|connect-desktop)\//, "headful.$1/");
    const savedFeatures = this.store.preference<Record<string, boolean>>("features", {});
    const renamedFeatures = Object.fromEntries(
      Object.entries(savedFeatures).map(([key, value]) => [namespace(key), value]),
    );
    if (JSON.stringify(savedFeatures) !== JSON.stringify(renamedFeatures))
      this.store.setPreference("features", renamedFeatures);
    const workspace = this.store.preference<unknown>("workspacePreferences", null);
    if (workspace) {
      const rewritten = JSON.stringify(workspace).replace(
        /"(admin-utilities|mcp-apps|connect-desktop)\//g,
        '"headful.$1/',
      );
      if (rewritten !== JSON.stringify(workspace))
        this.store.setPreference("workspacePreferences", JSON.parse(rewritten));
    }

    this.features = options.features;
    this.runtime = options.runtime;
    this.agentRunner = options.agentRunner;
    this.paths = Object.freeze({
      ...options.paths,
      modPackages: Object.freeze(
        Object.fromEntries(
          options.definitions
            .filter((definition) => definition.compiledEntryPath)
            .map((definition) => [definition.manifest.id, definition.compiledEntryPath!]),
        ),
      ),
    });
    const desktop = new Set<string>(),
      routes = new Set<string>();
    let mcpOwner: string | undefined;
    for (const definition of options.definitions) {
      const manifest = headfulModManifestSchema.parse(definition.manifest);
      if (this.entries.has(manifest.id))
        throw new HttpError(400, "mod_duplicate", "Bundled mod identifiers must be unique.");
      for (const feature of manifest.contributions.features)
        if (
          !feature.id.startsWith(`${manifest.id}/`) &&
          !(definition.nativeTrusted && !feature.id.includes("/"))
        )
          throw new HttpError(
            400,
            "mod_feature_namespace",
            "Mod features must use their mod namespace.",
          );
      for (const route of manifest.contributions.routes) {
        if (!route.path.startsWith(`/mods/${manifest.id}/`) || routes.has(route.path))
          throw new HttpError(
            400,
            "mod_route_collision",
            "Mod routes must use a unique mod namespace.",
          );
        routes.add(route.path);
        if (
          route.surfaceId &&
          !manifest.contributions.surfaces.some((surface) => surface.id === route.surfaceId)
        )
          throw new HttpError(
            400,
            "mod_surface_missing",
            "An mod route references a missing surface.",
          );
      }
      for (const capability of manifest.contributions.capabilities)
        if (capability.operations.some((operation) => !permittedOperations.has(operation)))
          throw new HttpError(
            400,
            "mod_capability_invalid",
            "Capabilities may reference only controlled Headful services.",
          );
      for (const operation of manifest.contributions.desktopOperations) {
        if (
          desktop.has(operation.id) ||
          Object.hasOwn(headfulInputSchemas, operation.id) ||
          operation.id.startsWith("mods.") ||
          operation.id.startsWith("features.") ||
          operation.id.startsWith("orgs.")
        )
          throw new HttpError(
            400,
            "mod_operation_collision",
            "Mod desktop operations conflict with an installed operation.",
          );
        if (operation.recovery && !definition.recover)
          throw new HttpError(
            400,
            "mod_recovery_missing",
            "A declared recovery operation requires a recovery handler.",
          );
        desktop.add(operation.id);
      }
      if (manifest.contributions.mcp.length) {
        if (mcpOwner)
          throw new HttpError(
            400,
            "mod_transport_collision",
            "Only one bundled mod can own the local MCP transport.",
          );
        mcpOwner = manifest.id;
      }
      for (const setting of manifest.settings)
        if (typeof setting.defaultValue !== setting.type)
          throw new HttpError(
            400,
            "mod_setting_type",
            "Mod setting defaults must match their declared types.",
          );
      this.entries.set(manifest.id, { definition, manifest, status: "inactive" });
    }
    this.features.registerMods(
      [...this.entries.values()]
        .filter((entry) => entry.manifest.apiVersion === headfulModApiVersion)
        .map((entry) => ({
          id: entry.manifest.id,
          features: entry.manifest.contributions.features,
        })),
      (id) => this.active(id),
    );
  }
  private permissions(entry: Entry): string[] {
    const revision = entry.definition.artifactRevision ?? "development";
    const grant = this.store.preference<{ revision: string; permissions: string[] } | null>(
      `mod:${entry.manifest.id}:grant`,
      null,
    );
    // Explicit saved consent never falls back to assembly permissions after an update.
    if (grant) return grant.revision === revision ? grant.permissions : [];
    return [...(entry.definition.hostPermissions ?? [])];
  }
  private hasPermissions(entry: Entry) {
    return entry.manifest.permissions.every((p) => this.permissions(entry).includes(p));
  }
  async startBackground(id: string, revision: string, reviewedSettings: unknown = {}) {
    const entry = this.entry(id);
    if (
      JSON.stringify(modSettingsSchema.parse(reviewedSettings)) !==
      JSON.stringify(this.settings(id).values)
    )
      throw new HttpError(
        409,
        "mod_review_stale",
        "Mod settings changed. Review the exact background scope again.",
      );
    if (revision !== entry.definition.artifactRevision)
      throw new HttpError(409, "mod_review_stale", "Review the current artifact.");
    await this.activateFor(id, "background");
    if (!entry.activation?.startBackground)
      throw new HttpError(400, "mod_background_missing", "No background handler.");
    await entry.activation.startBackground();
    this.requireActive(id);
    return this.inspect(id);
  }
  async fail(id: string) {
    const entry = this.entry(id);
    await this.dispose(entry);
    this.requested.delete(id);
    entry.status = "failed";
    entry.error = {
      code: "mod_execution_failed",
      message: "Mod execution stopped after a failure or resource limit.",
    };
  }
  async grant(id: string, revision: string, permissions: string[]) {
    const entry = this.entry(id);
    if (
      revision !== entry.definition.artifactRevision ||
      permissions.some(
        (p) => ![...entry.manifest.permissions, ...entry.manifest.optionalPermissions].includes(p),
      )
    )
      throw new HttpError(
        409,
        "mod_review_stale",
        "Review the current artifact and declared permissions.",
      );
    await this.dispose(entry);
    this.requested.delete(id);
    this.store.setPreference(`mod:${id}:grant`, { revision, permissions });
    await this.enqueue(() => this.reconcile());
    return this.inspect(id);
  }
  validateDefinitions(definitions: readonly HeadfulModDefinition[]) {
    return new ModManager({
      store: this.store,
      features: new FeatureService.FeatureManager(this.store),
      runtime: this.runtime,
      paths: this.paths,
      definitions,
    });
  }
  async replaceDefinitions(definitions: readonly HeadfulModDefinition[]) {
    const validated = this.validateDefinitions(definitions);
    for (const entry of this.orderedEntries().reverse()) await this.dispose(entry);
    this.features.resetMods();
    this.features.registerMods(
      [...validated.entries.values()].map((entry) => ({
        id: entry.manifest.id,
        features: entry.manifest.contributions.features,
      })),
      (id) => this.active(id),
    );
    this.entries.clear();
    this.requested.clear();
    this.paths = validated.paths;
    for (const [id, entry] of validated.entries) this.entries.set(id, entry);
    await this.reconcile();
  }
  async activateFeature(feature: string) {
    const entry = [...this.entries.values()].find((e) =>
      e.manifest.contributions.features.some((f) => f.id === feature),
    );
    if (entry) await this.activateFor(entry.manifest.id, "api");
  }
  private async activateFor(
    id: string,
    trigger: "command" | "view" | "api" | "event" | "background",
  ) {
    const entry = this.entry(id);
    if (!this.desired(entry)) throw new HttpError(403, "mod_disabled", "This mod is disabled.");
    if (!this.hasPermissions(entry) || !entry.manifest.activation.includes(trigger))
      throw new HttpError(
        403,
        "mod_permission_denied",
        "Enable the mod and review its required permissions first.",
      );
    this.requested.add(id);
    await this.enqueue(() => this.reconcile());
    this.requireActive(id);
  }
  async api(id: string, api: string, input: unknown, callerPermissions?: readonly string[]) {
    const entry = this.entry(id),
      declaration = entry.manifest.apis.find((x) => x.id === api);
    if (!declaration) throw new HttpError(404, "mod_api_missing", "Undeclared API.");
    if (callerPermissions && entry.manifest.permissions.some((p) => !callerPermissions.includes(p)))
      throw new HttpError(
        403,
        "mod_authority_expansion",
        "The provider requires authority the caller does not hold.",
      );
    await this.activateFor(id, "api");
    const values = validateValue(declaration.input, input);
    return this.invoke(entry, async () => {
      const result = await entry.activation!.dispatchApi?.(api, values);
      this.requireActive(id);
      return validateValue(declaration.output, result);
    });
  }
  private async invoke<T>(entry: Entry, handler: () => Promise<T>): Promise<T> {
    try {
      return await handler();
    } catch (error) {
      if (entry.status === "active") await this.fail(entry.manifest.id);
      throw error;
    }
  }
  async deleteData(id: string) {
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(id))
      throw new HttpError(400, "mod_identity", "Select a namespaced mod.");
    const entry = this.entries.get(id);
    if (entry) await this.disable(id);
    this.store.db
      .prepare("DELETE FROM preferences WHERE substr(key,1,?)=?")
      .run(`mod:${id}:`.length, `mod:${id}:`);
    await NodeFSP.rm(NodePath.join(this.paths.homeDir, "mod-data", id), {
      recursive: true,
      force: true,
    });
    return { deleted: true };
  }
  private desired(entry: Entry): boolean {
    const oldId = entry.manifest.id.replace(/^headful\./, "");
    const previous = this.store.preference<unknown>(
      `extension:${oldId}:enabled`,
      entry.manifest.defaultEnabled,
    );
    const value = this.store.preference<unknown>(`mod:${entry.manifest.id}:enabled`, previous);
    return value === true;
  }
  private entry(id: string) {
    const entry = this.entries.get(id);
    if (!entry)
      throw new HttpError(
        404,
        "mod_missing",
        "This mod is not bundled with this Headful installation.",
      );
    return entry;
  }
  active(id: string): boolean {
    const entry = this.entries.get(id);
    return Boolean(
      !this.closed &&
      entry?.activation &&
      this.hasPermissions(entry) &&
      this.desired(entry) &&
      entry.status === "active" &&
      !entry.controller?.signal.aborted,
    );
  }
  requireActive(id: string) {
    const entry = this.entry(id);
    if (entry.manifest.apiVersion !== headfulModApiVersion)
      throw new HttpError(
        409,
        "mod_incompatible",
        "This mod requires a different Headful mod API version.",
      );
    if (!this.active(id))
      throw new HttpError(
        403,
        "mod_disabled",
        "This mod is disabled or unavailable in Headful settings.",
      );
  }
  private descriptor(entry: Entry): HeadfulModDescriptor {
    return {
      manifest: entry.manifest,
      enabled: this.desired(entry),
      artifactRevision: entry.definition.artifactRevision ?? "development",
      grantedPermissions: this.permissions(entry),
      compatible: entry.manifest.apiVersion === headfulModApiVersion,
      status: !this.desired(entry) ? "disabled" : entry.status,
      runtimeStatuses: this.active(entry.manifest.id)
        ? [...(entry.runtimeStatuses?.values() ?? [])]
        : [],
      registeredCapabilities: this.active(entry.manifest.id)
        ? [...(entry.registeredCapabilities ?? [])]
        : [],
      ...(entry.error ? { error: entry.error } : {}),
    };
  }
  list() {
    return {
      apiVersion: headfulModApiVersion,
      mods: [...this.entries.values()].map((entry) => this.descriptor(entry)),
    };
  }
  inspect(id: string) {
    return this.descriptor(this.entry(id));
  }
  settings(id: string) {
    const entry = this.entry(id);
    const defaults = Object.fromEntries(
      entry.manifest.settings.map((setting) => [setting.key, setting.defaultValue]),
    );
    const stored = modSettingsSchema.safeParse(
      this.store.preference<unknown>(
        `mod:${id}:settings`,
        this.store.preference(`extension:${id.replace(/^headful\./, "")}:settings`, {}),
      ),
    );
    const values = { ...defaults };
    if (stored.success)
      for (const setting of entry.manifest.settings) {
        const value = stored.data[setting.key];
        if (value !== undefined && typeof value === setting.type) values[setting.key] = value;
      }
    return { id, values };
  }
  setSettings(id: string, input: unknown) {
    const entry = this.entry(id),
      values = modSettingsSchema.parse(input);
    for (const [key, value] of Object.entries(values)) {
      const setting = entry.manifest.settings.find((candidate) => candidate.key === key);
      if (!setting || typeof value !== setting.type)
        throw new HttpError(
          400,
          "mod_setting_invalid",
          "Use only settings and value types declared by this mod.",
        );
    }
    const next = { ...this.settings(id).values, ...values };
    this.store.setPreference(`mod:${id}:settings`, next);
    return { id, values: next };
  }
  private context(entry: Entry, signal: AbortSignal, recovery = false): HeadfulModContext {
    const id = entry.manifest.id;
    const assertContext = () => {
      if (this.closed || signal.aborted)
        throw new HttpError(
          403,
          "mod_stopped",
          "This mod has stopped. Reopen it in Headful to continue.",
        );
      if (
        !recovery &&
        !(
          this.desired(entry) &&
          this.hasPermissions(entry) &&
          entry.controller?.signal === signal &&
          ["active", "activating"].includes(entry.status)
        )
      )
        this.requireActive(id);
    };
    const runner = this.agentRunner?.forMod(id);
    const runnerAllowed = () => {
      assertContext();
      if (
        recovery ||
        entry.status !== "active" ||
        !this.permissions(entry).includes("local:agent-runner")
      )
        throw new HttpError(
          403,
          "mod_runner_denied",
          "Review native agent runner permission before using it.",
        );
    };
    const context: HeadfulModContext = {
      modId: id,
      ...(runner
        ? {
            agentRunner: {
              options: async () => {
                runnerAllowed();
                return runner.options();
              },
              launch: async (input) => {
                runnerAllowed();
                return runner.launch(input);
              },
              read: async (threadId) => {
                runnerAllowed();
                return runner.read(threadId);
              },
              message: async (input) => {
                runnerAllowed();
                return runner.message(input);
              },
              interrupt: async (input) => runner.interrupt(input),
              receipt: async (input) => {
                runnerAllowed();
                return runner.receipt(input);
              },
              revoke: async (threadId) => runner.revoke(threadId),
            },
          }
        : {}),
      permissions: {
        require: (permission) => {
          assertContext();
          if (!this.permissions(entry).includes(permission))
            throw new HttpError(
              403,
              "mod_permission_missing",
              "Review the requested capability before using it.",
            );
        },
      },
      signal,
      paths: this.paths,
      runtime: {
        dispatch: async (operation, input, authority) => {
          assertContext();
          if (
            !permittedOperations.has(operation) ||
            (recovery && !desktopReads.has(operation)) ||
            (authority.kind === "desktop" && !nativeSafeOperations.has(operation)) ||
            (entry.status === "activating" && !desktopReads.has(operation))
          )
            throw new HttpError(
              403,
              "mod_operation_denied",
              "Mods cannot issue human reviews or execute Salesforce writes.",
            );
          if (
            authority.source === "connect" &&
            (authority.kind !== "mcp" ||
              !this.permissions(entry).includes("local:remote-transport"))
          )
            throw new HttpError(
              403,
              "mod_remote_denied",
              "This mod has not declared remote transport authority.",
            );
          const utilityPolicy = Object.hasOwn(utilityOperationPolicies, operation)
            ? utilityOperationPolicies[operation as HeadfulUtilityOperation]
            : undefined;
          if (utilityPolicy) {
            if (!this.permissions(entry).includes(utilityPolicy.permission))
              throw new HttpError(
                403,
                "mod_permission_missing",
                "The mod has not declared this utility capability.",
              );
            if (utilityPolicy.desktopOnly && authority.kind !== "desktop")
              throw new HttpError(
                403,
                "mod_operation_denied",
                "This local utility action requires the native workspace.",
              );
            if (utilityPolicy.feature) this.features.require(utilityPolicy.feature);
          } else if (
            !this.permissions(entry).includes("salesforce:read") ||
            (proposalOperations.has(operation) &&
              !this.permissions(entry).includes("salesforce:propose"))
          )
            throw new HttpError(
              403,
              "mod_permission_missing",
              "The mod has not declared this Salesforce permission.",
            );
          const result = await this.runtime.dispatch(operation, input, authority);
          assertContext();
          return result;
        },
      },
      artifacts: {
        save: async (filename, mediaType, content) => {
          const previous = this.artifactWrites.get(id) ?? Promise.resolve();
          const result = previous
            .catch(() => {})
            .then(async () => {
              assertContext();
              if (
                !this.permissions(entry).includes("local:artifacts") ||
                !/^[a-zA-Z0-9_-]{1,80}\.(?:csv|json)$/.test(filename) ||
                !["text/csv", "application/json"].includes(mediaType) ||
                Buffer.byteLength(content) > 1024 * 1024
              )
                throw new HttpError(
                  403,
                  "mod_artifact_denied",
                  "Use an authorized bounded export.",
                );
              const handle = NodeCrypto.randomUUID(),
                directory = NodePath.join(this.paths.homeDir, "mod-data", id, "exports");
              await NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 });
              const files = await NodeFSP.readdir(directory);
              let bytes = 0;
              for (const file of files) {
                const info = await NodeFSP.lstat(NodePath.join(directory, file));
                if (!info.isFile() || info.isSymbolicLink())
                  throw new HttpError(403, "mod_artifact_denied", "Invalid export storage.");
                bytes += info.size;
              }
              if (files.length >= 100 || bytes + Buffer.byteLength(content) > 10 * 1024 * 1024)
                throw new HttpError(
                  413,
                  "mod_storage_limit",
                  "Export storage exceeds 100 files or 10 MiB. Remove exports explicitly before continuing.",
                );
              assertContext();
              await NodeFSP.writeFile(NodePath.join(directory, handle + "-" + filename), content, {
                mode: 0o600,
                flag: "wx",
              });
              assertContext();
              return {
                handle,
                size: Buffer.byteLength(content),
                sha256: NodeCrypto.createHash("sha256").update(content).digest("hex"),
              };
            });
          this.artifactWrites.set(id, result);
          try {
            return await result;
          } finally {
            if (this.artifactWrites.get(id) === result) this.artifactWrites.delete(id);
          }
        },
      },
      status: {
        publish: (value) => {
          assertContext();
          const parsed = modStatusValueSchema.parse(value);
          if (!entry.manifest.contributions.statuses.some((status) => status.id === parsed.id))
            throw new HttpError(
              403,
              "mod_status_undeclared",
              "Status must be declared in the manifest.",
            );
          (entry.runtimeStatuses ??= new Map()).set(parsed.id, parsed);
        },
      },
      events: {
        subscribe: (listener) => {
          assertContext();
          if (
            !this.permissions(entry).includes("host:events") &&
            entry.manifest.execution === "community"
          )
            throw new HttpError(
              403,
              "mod_permission_missing",
              "Host events require explicit permission.",
            );
          if ((entry.listeners?.size ?? 0) >= 20)
            throw new HttpError(429, "mod_event_limit", "Too many listeners.");
          (entry.listeners ??= new Set()).add(listener);
          const remove = () => entry.listeners?.delete(listener);
          signal.addEventListener("abort", remove, { once: true });
          return () => {
            remove();
            signal.removeEventListener("abort", remove);
          };
        },
      },
      capabilities: {
        register: (capabilityId) => {
          assertContext();
          const capability = entry.manifest.contributions.capabilities.find(
            (value) => value.id === capabilityId,
          );
          if (!capability)
            throw new HttpError(
              403,
              "mod_capability_undeclared",
              "Declare the capability before registering it.",
            );
          (entry.registeredCapabilities ??= new Set()).add(capabilityId);
          return {
            dispatch: (operation, input, authority) => {
              assertContext();
              if (!capability.operations.includes(operation))
                throw new HttpError(
                  403,
                  "mod_capability_denied",
                  "This operation is outside the registered capability.",
                );
              return context.runtime.dispatch(operation, input, authority);
            },
          };
        },
      },
      settings: {
        get: () => this.settings(id).values,
        set: (values) => {
          assertContext();
          if (!this.permissions(entry).includes("local:settings"))
            throw new HttpError(
              403,
              "mod_permission_missing",
              "This mod cannot change scoped settings.",
            );
          this.setSettings(id, values);
        },
      },
      requireActive: assertContext,
      requireFeature: (feature) => {
        assertContext();
        if (
          entry.status === "activating" &&
          entry.manifest.contributions.features.some((item) => item.id === feature)
        ) {
          if (!this.features.configuredEnabled(feature))
            throw new HttpError(403, "feature_disabled", "The mod's required feature is disabled.");
        } else this.features.require(feature);
      },
    };
    return Object.freeze(context);
  }
  async publishEvent(event: HeadfulModEvent) {
    serializable(event);
    for (const entry of this.entries.values())
      if (
        this.desired(entry) &&
        this.hasPermissions(entry) &&
        entry.manifest.activation.includes("event") &&
        entry.manifest.contributions.events.includes(event.type) &&
        !this.active(entry.manifest.id)
      )
        await this.activateFor(entry.manifest.id, "event");
    for (const entry of this.entries.values())
      if (
        this.active(entry.manifest.id) &&
        entry.manifest.contributions.events.includes(event.type) &&
        (entry.manifest.execution === "native" ||
          (this.permissions(entry).includes("host:events") &&
            entry.manifest.eventSubscriptions.some(
              (subscription) =>
                subscription.type === event.type &&
                Object.entries(subscription.filter).every(
                  ([key, value]) => (event as unknown as Record<string, unknown>)[key] === value,
                ),
            )))
      )
        for (const listener of entry.listeners ?? []) {
          try {
            this.requireActive(entry.manifest.id);
            await listener(serializable(event) as HeadfulModEvent);
          } catch {
            entry.error = {
              code: "mod_event_failed",
              message: "An mod could not handle a host event. Check its connection state.",
            };
          }
        }
  }
  private enqueue(work: () => Promise<void>) {
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }
  initialize(): Promise<void> {
    if (this.closed)
      return Promise.reject(
        new HttpError(503, "mod_runtime_closed", "Headful's mod runtime has stopped."),
      );
    if (this.initialized) return this.queue;
    this.initialized = true;
    return this.enqueue(() => this.reconcile());
  }
  private dependencyError(entry: Entry, path: Set<string> = new Set()): string | null {
    if (path.has(entry.manifest.id)) return "Plugin dependencies contain a cycle.";
    for (const dependency of entry.manifest.dependencies) {
      const target = this.entries.get(dependency.id);
      if (!target && dependency.optional) continue;
      if (!target || !this.desired(target)) return "A required mod is missing or disabled.";
      if (
        target.manifest.apiVersion !== headfulModApiVersion ||
        (dependency.version && !compatible(dependency.version, target.manifest.version))
      )
        return "A required mod version is incompatible.";
      if (
        target.cleanupFailed ||
        target.manifest.requiredFeatures.some((id) => !this.features.configuredEnabled(id))
      )
        return "A required mod feature is disabled or unavailable.";
      const nested = this.dependencyError(target, new Set([...path, entry.manifest.id]));
      if (nested) return nested;
    }
    return null;
  }
  private async dispose(entry: Entry) {
    entry.controller?.abort();
    const activation = entry.activation;
    delete entry.activation;
    delete entry.controller;
    entry.runtimeStatuses?.clear();
    entry.registeredCapabilities?.clear();
    entry.listeners?.clear();
    entry.status = "inactive";
    if (activation) {
      try {
        await activation.dispose();
      } catch {
        entry.cleanupFailed = true;
        entry.error = {
          code: "mod_dispose_failed",
          message:
            "The mod stopped, but one cleanup operation failed. Restart Headful before enabling it again.",
        };
      }
    }
  }
  private async reconcile() {
    if (this.closed) return;
    // Dispose dependents before their dependencies, regardless of registration order.
    for (const entry of this.orderedEntries().reverse())
      if (
        !this.desired(entry) ||
        entry.manifest.apiVersion !== headfulModApiVersion ||
        this.dependencyError(entry) ||
        entry.manifest.requiredFeatures.some((id) => !this.features.configuredEnabled(id))
      )
        await this.dispose(entry);
    const activated = new Set<string>();
    const visit = async (entry: Entry): Promise<void> => {
      if (activated.has(entry.manifest.id)) return;
      activated.add(entry.manifest.id);
      const compatible = entry.manifest.apiVersion === headfulModApiVersion;
      const dependencyError = this.dependencyError(entry);
      const blockedFeatures = entry.manifest.requiredFeatures.some(
        (id) => !this.features.configuredEnabled(id),
      );
      if (!this.desired(entry) || !compatible || dependencyError || blockedFeatures) {
        await this.dispose(entry);
        entry.status = !this.desired(entry) ? "disabled" : !compatible ? "incompatible" : "blocked";
        if (this.desired(entry))
          entry.error = {
            code: !compatible ? "mod_incompatible" : "mod_dependency_unavailable",
            message: !compatible
              ? "This package requires another Headful mod API version."
              : (dependencyError ?? "Enable this mod's required features in Headful settings."),
          };
        else if (!entry.cleanupFailed) delete entry.error;
        return;
      }
      if (entry.cleanupFailed) {
        entry.status = "failed";
        return;
      }
      for (const dependency of entry.manifest.dependencies)
        if (this.entries.has(dependency.id)) {
          this.requested.add(dependency.id);
          await visit(this.entry(dependency.id));
        }
      if (
        entry.manifest.dependencies.some(
          (dependency) => !dependency.optional && !this.active(dependency.id),
        )
      ) {
        await this.dispose(entry);
        entry.status = "blocked";
        entry.error = {
          code: "mod_dependency_unavailable",
          message: "A required mod could not activate.",
        };
        return;
      }
      if (entry.activation) return;
      if (!this.requested.has(entry.manifest.id) || !this.hasPermissions(entry)) {
        entry.status = "inactive";
        return;
      }
      const controller = new AbortController();
      entry.controller = controller;
      entry.status = "activating";
      delete entry.error;
      try {
        const activation = await entry.definition.activate(this.context(entry, controller.signal));
        if (!this.desired(entry) || controller.signal.aborted || this.closed) {
          await activation.dispose();
          entry.status = "disabled";
          delete entry.controller;
          entry.runtimeStatuses?.clear();
          entry.registeredCapabilities?.clear();
          entry.listeners?.clear();
          return;
        }
        if (
          (entry.manifest.contributions.mcp.length && !activation.handleMcp) ||
          (entry.manifest.contributions.desktopOperations.some(
            (operation) => !operation.recovery,
          ) &&
            !activation.dispatchDesktopIntegration) ||
          (entry.manifest.contributions.commands.length && !activation.dispatchCommand) ||
          (entry.manifest.contributions.surfaces.length && !activation.renderSurface)
        ) {
          await activation.dispose();
          throw new HttpError(
            400,
            "mod_contribution_missing",
            "An mod did not implement its declared contributions.",
          );
        }
        entry.activation = activation;
        entry.status = "active";
      } catch {
        controller.abort();
        delete entry.controller;
        entry.runtimeStatuses?.clear();
        entry.registeredCapabilities?.clear();
        entry.listeners?.clear();
        entry.status = "failed";
        entry.error = {
          code: "mod_activation_failed",
          message: "This mod could not start. Check its configuration or restart Headful.",
        };
      }
    };
    for (const entry of this.entries.values()) await visit(entry);
  }
  private orderedEntries(): Entry[] {
    const result: Entry[] = [],
      visited = new Set<string>();
    const visit = (entry: Entry) => {
      if (visited.has(entry.manifest.id)) return;
      visited.add(entry.manifest.id);
      for (const dependency of entry.manifest.dependencies) {
        const target = this.entries.get(dependency.id);
        if (target) visit(target);
      }
      result.push(entry);
    };
    for (const entry of this.entries.values()) visit(entry);
    return result;
  }
  async enable(id: string) {
    const entry = this.entry(id);
    if (entry.manifest.apiVersion !== headfulModApiVersion)
      throw new HttpError(
        409,
        "mod_incompatible",
        "This mod requires another Headful mod API version.",
      );
    if (entry.cleanupFailed)
      throw new HttpError(
        503,
        "mod_restart_required",
        "Restart Headful before enabling this mod after a cleanup failure.",
      );
    this.store.setPreference(`mod:${id}:enabled`, true);
    await this.enqueue(() => this.reconcile());
    return this.inspect(id);
  }
  async disable(id: string) {
    const entry = this.entry(id);
    this.store.setPreference(`mod:${id}:enabled`, false);
    entry.controller?.abort();
    // Dependents cease exposing capabilities immediately, before async disposal.
    for (const candidate of this.entries.values())
      if (this.dependencyError(candidate)) candidate.controller?.abort();
    await this.enqueue(() => this.reconcile());
    return this.inspect(id);
  }
  async featureChanged(id: string, enabled: boolean) {
    for (const entry of this.entries.values())
      if (
        entry.manifest.requiredFeatures.some((feature) => !this.features.configuredEnabled(feature))
      )
        entry.controller?.abort();
    await this.enqueue(async () => {
      await this.reconcile();
      for (const entry of this.entries.values())
        if (
          this.active(entry.manifest.id) &&
          entry.manifest.contributions.hooks.includes("feature-changed")
        ) {
          try {
            await entry.activation?.onFeatureChange?.({ id, enabled });
          } catch {
            await this.dispose(entry);
            entry.status = "failed";
            entry.error = {
              code: "mod_hook_failed",
              message: "The mod stopped after a lifecycle hook failed.",
            };
          }
        }
    });
  }
  acceptsDesktopIntegration(operation: string) {
    return [...this.entries.values()].some((entry) =>
      entry.manifest.contributions.desktopOperations.some((item) => item.id === operation),
    );
  }
  private requireArtifactRevision(entry: Entry, revision?: string) {
    if (
      this.entries.get(entry.manifest.id) !== entry ||
      (revision && revision !== (entry.definition.artifactRevision ?? "development"))
    )
      throw new HttpError(
        409,
        "mod_revision_changed",
        "This mod changed. Recheck Headful before using its tools.",
      );
  }
  async command(id: string, command: string, input: unknown, artifactRevision?: string) {
    const entry = this.entry(id),
      declaration = entry.manifest.contributions.commands.find((item) => item.id === command);
    if (!declaration)
      throw new HttpError(404, "mod_command_missing", "This command is not declared by the mod.");
    this.requireArtifactRevision(entry, artifactRevision);
    await this.activateFor(id, "command");
    this.requireArtifactRevision(entry, artifactRevision);
    for (const feature of declaration.requiredFeatures) this.features.require(feature);
    if (declaration.inputSchema) validateValue(declaration.inputSchema, input);
    const values = modSettingsSchema.parse(input);
    for (const [key, value] of Object.entries(values))
      if (
        !declaration.parameters.some(
          (parameter) => parameter.key === key && parameter.type === typeof value,
        )
      )
        throw new HttpError(
          400,
          "mod_command_input",
          "The command parameters do not match its declaration.",
        );
    for (const parameter of declaration.parameters)
      if (parameter.required && !Object.hasOwn(values, parameter.key))
        throw new HttpError(
          400,
          "mod_command_input",
          "This mod command requires another parameter.",
        );
    const result = modCommandResultSchema.parse(
      await this.invoke(entry, () => entry.activation!.dispatchCommand!(command, values)),
    );
    if (declaration.outputSchema) validateValue(declaration.outputSchema, result);
    this.requireActive(id);
    this.requireArtifactRevision(entry, artifactRevision);
    return result;
  }
  async surface(id: string, surfaceId: string, artifactRevision?: string) {
    const entry = this.entry(id),
      declaration = entry.manifest.contributions.surfaces.find((item) => item.id === surfaceId);
    if (!declaration)
      throw new HttpError(404, "mod_surface_missing", "This surface is not declared by the mod.");
    this.requireArtifactRevision(entry, artifactRevision);
    await this.activateFor(id, "view");
    this.requireArtifactRevision(entry, artifactRevision);
    for (const feature of declaration.requiredFeatures) this.features.require(feature);
    const result = modSurfaceResultSchema.parse(
      await this.invoke(entry, () => entry.activation!.renderSurface!(surfaceId)),
    );
    this.requireActive(id);
    this.requireArtifactRevision(entry, artifactRevision);
    return result;
  }
  async dispatchDesktopIntegration(operation: string, input: unknown): Promise<unknown> {
    await this.initialize();
    const entry = [...this.entries.values()].find((candidate) =>
      candidate.manifest.contributions.desktopOperations.some((item) => item.id === operation),
    );
    if (!entry)
      throw new HttpError(
        404,
        "mod_operation_missing",
        "This mod operation is not bundled with Headful.",
      );
    const declared = entry.manifest.contributions.desktopOperations.find(
      (item) => item.id === operation,
    )!;
    if (declared.recovery && entry.definition.recover) {
      if (entry.manifest.apiVersion !== headfulModApiVersion)
        throw new HttpError(
          409,
          "mod_incompatible",
          "Use a compatible mod before managing its local configuration.",
        );
      return entry.definition.recover(
        this.context(entry, new AbortController().signal, true),
        operation,
        input,
      );
    }
    await this.activateFor(entry.manifest.id, "command");
    for (const feature of declared.requiredFeatures) this.features.require(feature);
    const result = await entry.activation!.dispatchDesktopIntegration!(operation, input);
    this.requireActive(entry.manifest.id);
    return result;
  }
  async handleMcp(request: Request): Promise<Response> {
    await this.initialize();
    const entry = [...this.entries.values()].find(
      (candidate) => candidate.manifest.contributions.mcp.length,
    );
    if (!entry)
      throw new HttpError(
        404,
        "mod_missing",
        "The local MCP mod is not bundled with this installation.",
      );
    await this.activateFor(entry.manifest.id, "api");
    if (!this.permissions(entry).includes("local:mcp-transport"))
      throw new HttpError(
        403,
        "mod_permission_missing",
        "The mod has not declared local MCP transport permission.",
      );
    for (const feature of entry.manifest.contributions.mcp[0]!.requiredFeatures)
      this.features.require(feature);
    const response = await entry.activation!.handleMcp!(request);
    this.requireActive(entry.manifest.id);
    return response;
  }
  close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      for (const entry of this.entries.values()) entry.controller?.abort();
      return this.enqueue(async () => {
        for (const entry of this.orderedEntries().reverse()) {
          await this.dispose(entry);
          entry.status = "disabled";
        }
      });
    }
    return this.queue;
  }
}
export class ModService extends Context.Service<ModService, { readonly mods: ModManager }>()(
  "t3/headful/mods/ModManager/ModService",
) {}
export const layer = (mods: ModManager) => Layer.succeed(ModService, ModService.of({ mods }));
