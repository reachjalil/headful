import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import {
  headfulExtensionApiVersion,
  headfulExtensionManifestSchema,
  headfulExtensionOperations,
  extensionSettingsSchema,
  extensionCommandResultSchema,
  extensionSurfaceResultSchema,
  type HeadfulExtensionActivation,
  type HeadfulExtensionContext,
  type HeadfulExtensionDefinition,
  type HeadfulExtensionDescriptor,
  type HeadfulExtensionManifest,
  type HeadfulExtensionPaths,
} from "../../../../../packages/contracts/src/headful-extensions.ts";
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
  definition: HeadfulExtensionDefinition;
  manifest: HeadfulExtensionManifest;
  status: HeadfulExtensionDescriptor["status"];
  error?: HeadfulExtensionDescriptor["error"];
  controller?: AbortController;
  activation?: HeadfulExtensionActivation;
  cleanupFailed?: boolean;
};
const permittedOperations = new Set<string>(headfulExtensionOperations);
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

/** Definitions arrive only from the host's reviewed bundled-package registry.
 * Native code is trusted. This manager governs contribution visibility and
 * application authority, and deliberately has no download/import/eval API. */
export class ExtensionManager {
  private readonly entries = new Map<string, Entry>();
  private readonly store: Store.LocalStore;
  private readonly features: FeatureService.FeatureManager;
  private readonly runtime: RuntimePort;
  private readonly paths: HeadfulExtensionPaths;
  private queue: Promise<void> = Promise.resolve();
  private initialized = false;
  private closed = false;
  constructor(options: {
    store: Store.LocalStore;
    features: FeatureService.FeatureManager;
    runtime: RuntimePort;
    paths: HeadfulExtensionPaths;
    definitions: readonly HeadfulExtensionDefinition[];
  }) {
    this.store = options.store;
    this.features = options.features;
    this.runtime = options.runtime;
    this.paths = Object.freeze({ ...options.paths });
    const desktop = new Set<string>(),
      routes = new Set<string>();
    let mcpOwner: string | undefined;
    for (const definition of options.definitions) {
      const manifest = headfulExtensionManifestSchema.parse(definition.manifest);
      if (this.entries.has(manifest.id))
        throw new HttpError(
          400,
          "extension_duplicate",
          "Bundled extension identifiers must be unique.",
        );
      for (const feature of manifest.contributions.features)
        if (
          !feature.id.startsWith(`${manifest.id}/`) &&
          !(manifest.id === "mcp-apps" && ["local-mcp", "external-harness"].includes(feature.id))
        )
          throw new HttpError(
            400,
            "extension_feature_namespace",
            "Extension features must use their extension namespace.",
          );
      for (const route of manifest.contributions.routes) {
        if (!route.path.startsWith(`/extensions/${manifest.id}/`) || routes.has(route.path))
          throw new HttpError(
            400,
            "extension_route_collision",
            "Extension routes must use a unique extension namespace.",
          );
        routes.add(route.path);
        if (
          route.surfaceId &&
          !manifest.contributions.surfaces.some((surface) => surface.id === route.surfaceId)
        )
          throw new HttpError(
            400,
            "extension_surface_missing",
            "An extension route references a missing surface.",
          );
      }
      for (const operation of manifest.contributions.desktopOperations) {
        if (
          desktop.has(operation.id) ||
          Object.hasOwn(headfulInputSchemas, operation.id) ||
          operation.id.startsWith("extensions.") ||
          operation.id.startsWith("features.") ||
          operation.id.startsWith("orgs.")
        )
          throw new HttpError(
            400,
            "extension_operation_collision",
            "Extension desktop operations conflict with an installed operation.",
          );
        if (operation.recovery && !definition.recover)
          throw new HttpError(
            400,
            "extension_recovery_missing",
            "A declared recovery operation requires a recovery handler.",
          );
        desktop.add(operation.id);
      }
      if (manifest.contributions.mcp.length) {
        if (mcpOwner)
          throw new HttpError(
            400,
            "extension_transport_collision",
            "Only one bundled extension can own the local MCP transport.",
          );
        mcpOwner = manifest.id;
      }
      for (const setting of manifest.settings)
        if (typeof setting.defaultValue !== setting.type)
          throw new HttpError(
            400,
            "extension_setting_type",
            "Extension setting defaults must match their declared types.",
          );
      this.entries.set(manifest.id, { definition, manifest, status: "inactive" });
    }
    this.features.registerExtensions(
      [...this.entries.values()]
        .filter((entry) => entry.manifest.apiVersion === headfulExtensionApiVersion)
        .map((entry) => ({
          id: entry.manifest.id,
          features: entry.manifest.contributions.features,
        })),
      (id) => this.active(id),
    );
  }
  private desired(entry: Entry): boolean {
    const value = this.store.preference<unknown>(
      `extension:${entry.manifest.id}:enabled`,
      entry.manifest.defaultEnabled,
    );
    return value === true;
  }
  private entry(id: string) {
    const entry = this.entries.get(id);
    if (!entry)
      throw new HttpError(
        404,
        "extension_missing",
        "This extension is not bundled with this Headful installation.",
      );
    return entry;
  }
  active(id: string): boolean {
    const entry = this.entries.get(id);
    return Boolean(
      !this.closed &&
      entry?.activation &&
      this.desired(entry) &&
      entry.status === "active" &&
      !entry.controller?.signal.aborted,
    );
  }
  requireActive(id: string) {
    const entry = this.entry(id);
    if (entry.manifest.apiVersion !== headfulExtensionApiVersion)
      throw new HttpError(
        409,
        "extension_incompatible",
        "This extension requires a different Headful extension API version.",
      );
    if (!this.active(id))
      throw new HttpError(
        403,
        "extension_disabled",
        "This extension is disabled or unavailable in Headful settings.",
      );
  }
  private descriptor(entry: Entry): HeadfulExtensionDescriptor {
    return {
      manifest: entry.manifest,
      enabled: this.desired(entry),
      compatible: entry.manifest.apiVersion === headfulExtensionApiVersion,
      status: !this.desired(entry) ? "disabled" : entry.status,
      ...(entry.error ? { error: entry.error } : {}),
    };
  }
  list() {
    return {
      apiVersion: headfulExtensionApiVersion,
      extensions: [...this.entries.values()].map((entry) => this.descriptor(entry)),
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
    const stored = extensionSettingsSchema.safeParse(
      this.store.preference<unknown>(`extension:${id}:settings`, {}),
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
      values = extensionSettingsSchema.parse(input);
    for (const [key, value] of Object.entries(values)) {
      const setting = entry.manifest.settings.find((candidate) => candidate.key === key);
      if (!setting || typeof value !== setting.type)
        throw new HttpError(
          400,
          "extension_setting_invalid",
          "Use only settings and value types declared by this extension.",
        );
    }
    const next = { ...this.settings(id).values, ...values };
    this.store.setPreference(`extension:${id}:settings`, next);
    return { id, values: next };
  }
  private context(entry: Entry, signal: AbortSignal, recovery = false): HeadfulExtensionContext {
    const id = entry.manifest.id;
    const assertContext = () => {
      if (this.closed || signal.aborted)
        throw new HttpError(
          403,
          "extension_stopped",
          "This extension has stopped. Reopen it in Headful to continue.",
        );
      if (
        !recovery &&
        !(
          this.desired(entry) &&
          entry.controller?.signal === signal &&
          ["active", "activating"].includes(entry.status)
        )
      )
        this.requireActive(id);
    };
    const context: HeadfulExtensionContext = {
      extensionId: id,
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
              "extension_operation_denied",
              "Extensions cannot issue human reviews or execute Salesforce writes.",
            );
          const utilityPolicy = Object.hasOwn(utilityOperationPolicies, operation)
            ? utilityOperationPolicies[operation as HeadfulUtilityOperation]
            : undefined;
          if (utilityPolicy) {
            if (!entry.manifest.permissions.includes(utilityPolicy.permission))
              throw new HttpError(
                403,
                "extension_permission_missing",
                "The extension has not declared this utility capability.",
              );
            if (utilityPolicy.desktopOnly && authority.kind !== "desktop")
              throw new HttpError(
                403,
                "extension_operation_denied",
                "This local utility action requires the native workspace.",
              );
            if (utilityPolicy.feature) this.features.require(utilityPolicy.feature);
          } else if (
            !entry.manifest.permissions.includes("salesforce:read") ||
            (proposalOperations.has(operation) &&
              !entry.manifest.permissions.includes("salesforce:propose"))
          )
            throw new HttpError(
              403,
              "extension_permission_missing",
              "The extension has not declared this Salesforce permission.",
            );
          const result = await this.runtime.dispatch(operation, input, authority);
          assertContext();
          return result;
        },
      },
      settings: {
        get: () => this.settings(id).values,
        set: (values) => {
          assertContext();
          if (!entry.manifest.permissions.includes("local:settings"))
            throw new HttpError(
              403,
              "extension_permission_missing",
              "This extension cannot change scoped settings.",
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
            throw new HttpError(
              403,
              "feature_disabled",
              "The extension's required feature is disabled.",
            );
        } else this.features.require(feature);
      },
    };
    return Object.freeze(context);
  }
  private enqueue(work: () => Promise<void>) {
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }
  initialize(): Promise<void> {
    if (this.closed)
      return Promise.reject(
        new HttpError(503, "extension_runtime_closed", "Headful's extension runtime has stopped."),
      );
    if (this.initialized) return this.queue;
    this.initialized = true;
    return this.enqueue(() => this.reconcile());
  }
  private dependencyError(entry: Entry, path: Set<string> = new Set()): string | null {
    if (path.has(entry.manifest.id)) return "Plugin dependencies contain a cycle.";
    for (const dependency of entry.manifest.dependencies) {
      const target = this.entries.get(dependency.id);
      if (!target || !this.desired(target)) return "A required extension is missing or disabled.";
      if (
        target.manifest.apiVersion !== headfulExtensionApiVersion ||
        (dependency.version && dependency.version !== target.manifest.version)
      )
        return "A required extension version is incompatible.";
      if (
        target.cleanupFailed ||
        target.manifest.requiredFeatures.some((id) => !this.features.configuredEnabled(id))
      )
        return "A required extension feature is disabled or unavailable.";
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
    entry.status = "inactive";
    if (activation) {
      try {
        await activation.dispose();
      } catch {
        entry.cleanupFailed = true;
        entry.error = {
          code: "extension_dispose_failed",
          message:
            "The extension stopped, but one cleanup operation failed. Restart Headful before enabling it again.",
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
        entry.manifest.apiVersion !== headfulExtensionApiVersion ||
        this.dependencyError(entry) ||
        entry.manifest.requiredFeatures.some((id) => !this.features.configuredEnabled(id))
      )
        await this.dispose(entry);
    const activated = new Set<string>();
    const visit = async (entry: Entry): Promise<void> => {
      if (activated.has(entry.manifest.id)) return;
      activated.add(entry.manifest.id);
      const compatible = entry.manifest.apiVersion === headfulExtensionApiVersion;
      const dependencyError = this.dependencyError(entry);
      const blockedFeatures = entry.manifest.requiredFeatures.some(
        (id) => !this.features.configuredEnabled(id),
      );
      if (!this.desired(entry) || !compatible || dependencyError || blockedFeatures) {
        await this.dispose(entry);
        entry.status = !this.desired(entry) ? "disabled" : !compatible ? "incompatible" : "blocked";
        if (this.desired(entry))
          entry.error = {
            code: !compatible ? "extension_incompatible" : "extension_dependency_unavailable",
            message: !compatible
              ? "This package requires another Headful extension API version."
              : (dependencyError ??
                "Enable this extension's required features in Headful settings."),
          };
        else if (!entry.cleanupFailed) delete entry.error;
        return;
      }
      if (entry.cleanupFailed) {
        entry.status = "error";
        return;
      }
      for (const dependency of entry.manifest.dependencies) await visit(this.entry(dependency.id));
      if (entry.manifest.dependencies.some((dependency) => !this.active(dependency.id))) {
        await this.dispose(entry);
        entry.status = "blocked";
        entry.error = {
          code: "extension_dependency_unavailable",
          message: "A required extension could not activate.",
        };
        return;
      }
      if (entry.activation) return;
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
            "extension_contribution_missing",
            "An extension did not implement its declared contributions.",
          );
        }
        entry.activation = activation;
        entry.status = "active";
      } catch {
        controller.abort();
        delete entry.controller;
        entry.status = "error";
        entry.error = {
          code: "extension_activation_failed",
          message: "This extension could not start. Check its configuration or restart Headful.",
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
    if (entry.manifest.apiVersion !== headfulExtensionApiVersion)
      throw new HttpError(
        409,
        "extension_incompatible",
        "This extension requires another Headful extension API version.",
      );
    if (entry.cleanupFailed)
      throw new HttpError(
        503,
        "extension_restart_required",
        "Restart Headful before enabling this extension after a cleanup failure.",
      );
    this.store.setPreference(`extension:${id}:enabled`, true);
    await this.enqueue(() => this.reconcile());
    return this.inspect(id);
  }
  async disable(id: string) {
    const entry = this.entry(id);
    this.store.setPreference(`extension:${id}:enabled`, false);
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
            entry.status = "error";
            entry.error = {
              code: "extension_hook_failed",
              message: "The extension stopped after a lifecycle hook failed.",
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
  async command(id: string, command: string, input: unknown) {
    const entry = this.entry(id),
      declaration = entry.manifest.contributions.commands.find((item) => item.id === command);
    if (!declaration)
      throw new HttpError(
        404,
        "extension_command_missing",
        "This command is not declared by the extension.",
      );
    this.requireActive(id);
    for (const feature of declaration.requiredFeatures) this.features.require(feature);
    const values = extensionSettingsSchema.parse(input);
    for (const [key, value] of Object.entries(values))
      if (
        !declaration.parameters.some(
          (parameter) => parameter.key === key && parameter.type === typeof value,
        )
      )
        throw new HttpError(
          400,
          "extension_command_input",
          "The command parameters do not match its declaration.",
        );
    for (const parameter of declaration.parameters)
      if (parameter.required && !Object.hasOwn(values, parameter.key))
        throw new HttpError(
          400,
          "extension_command_input",
          "This extension command requires another parameter.",
        );
    const result = extensionCommandResultSchema.parse(
      await entry.activation!.dispatchCommand!(command, values),
    );
    this.requireActive(id);
    return result;
  }
  async surface(id: string, surfaceId: string) {
    const entry = this.entry(id),
      declaration = entry.manifest.contributions.surfaces.find((item) => item.id === surfaceId);
    if (!declaration)
      throw new HttpError(
        404,
        "extension_surface_missing",
        "This surface is not declared by the extension.",
      );
    this.requireActive(id);
    for (const feature of declaration.requiredFeatures) this.features.require(feature);
    const result = extensionSurfaceResultSchema.parse(
      await entry.activation!.renderSurface!(surfaceId),
    );
    this.requireActive(id);
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
        "extension_operation_missing",
        "This extension operation is not bundled with Headful.",
      );
    const declared = entry.manifest.contributions.desktopOperations.find(
      (item) => item.id === operation,
    )!;
    if (declared.recovery && entry.definition.recover) {
      if (entry.manifest.apiVersion !== headfulExtensionApiVersion)
        throw new HttpError(
          409,
          "extension_incompatible",
          "Use a compatible extension before managing its local configuration.",
        );
      return entry.definition.recover(
        this.context(entry, new AbortController().signal, true),
        operation,
        input,
      );
    }
    this.requireActive(entry.manifest.id);
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
        "extension_missing",
        "The local MCP extension is not bundled with this installation.",
      );
    this.requireActive(entry.manifest.id);
    if (!entry.manifest.permissions.includes("local:mcp-transport"))
      throw new HttpError(
        403,
        "extension_permission_missing",
        "The extension has not declared local MCP transport permission.",
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
export class ExtensionService extends Context.Service<
  ExtensionService,
  { readonly extensions: ExtensionManager }
>()("t3/headful/extensions/ExtensionManager/ExtensionService") {}
export const layer = (extensions: ExtensionManager) =>
  Layer.succeed(ExtensionService, ExtensionService.of({ extensions }));
