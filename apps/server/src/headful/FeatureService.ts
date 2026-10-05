import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Store from "./Store.ts";
import { HttpError } from "./domain/types.ts";
import { extensionFeatureSchema } from "../../../../packages/contracts/src/headful-extensions.ts";
import type { z } from "zod";
export const featureRegistry = [
  {
    id: "org-management",
    name: "Org management",
    description: "Connect, import and organize Salesforce CLI orgs.",
    availability: "available",
    defaultEnabled: true,
    dependencies: [],
    configuration: [],
    permissions: [],
    route: "orgs",
    lifecycle: "on-demand",
  },
  {
    id: "salesforce-workspace",
    name: "Salesforce workspace",
    description: "Inspect leads, users, permission sets and access.",
    availability: "available",
    defaultEnabled: true,
    dependencies: ["org-management"],
    configuration: ["Salesforce CLI connection"],
    permissions: [],
    route: "workspace",
    lifecycle: "on-demand",
  },
  {
    id: "reviewed-changes",
    name: "Activity and reviewed changes",
    description: "Prepare exact changes and confirm them in Headful.",
    availability: "available",
    defaultEnabled: true,
    dependencies: ["salesforce-workspace"],
    configuration: [],
    permissions: [],
    route: "activity",
    lifecycle: "gate-writes",
  },
  {
    id: "internal-chat",
    name: "Experimental internal chat",
    description: "Enable the retained T3 chat and session foundation.",
    availability: "experimental",
    defaultEnabled: false,
    dependencies: ["agent-providers"],
    configuration: ["Optional agent provider"],
    permissions: [],
    route: "chat",
    lifecycle: "gate-navigation",
  },
  {
    id: "agent-providers",
    name: "Optional agent providers",
    description: "Use your existing supported agent subscription and CLI.",
    availability: "experimental",
    defaultEnabled: false,
    dependencies: [],
    configuration: ["Provider authentication"],
    permissions: [],
    route: "chat",
    lifecycle: "gate-provider",
  },
  {
    id: "launch-at-login",
    name: "Launch at login",
    description: "Start the Headful menu bar when you sign in to your Mac.",
    availability: "available",
    defaultEnabled: false,
    dependencies: [],
    configuration: [],
    permissions: [],
    route: "settings",
    lifecycle: "desktop-login-item",
  },
] as const;
export type FeatureId = string;
type Feature = z.output<typeof extensionFeatureSchema> & { extensionId?: string };
export class FeatureManager {
  private store: Store.LocalStore;
  private registry: Feature[] = featureRegistry.map((feature) => ({
    ...feature,
    dependencies: [...feature.dependencies],
    configuration: [...feature.configuration],
    permissions: [...feature.permissions],
  }));
  private extensionActive: (id: string) => boolean = () => false;
  constructor(store: Store.LocalStore) {
    this.store = store;
  }
  registerExtensions(
    contributions: readonly {
      id: string;
      features: readonly z.output<typeof extensionFeatureSchema>[];
    }[],
    isActive: (id: string) => boolean,
  ) {
    const registry = [...this.registry];
    for (const contribution of contributions) {
      for (const feature of contribution.features) {
        if (registry.some((existing) => existing.id === feature.id))
          throw new HttpError(
            400,
            "extension_feature_collision",
            "An extension feature conflicts with an installed feature.",
          );
        registry.push({ ...feature, extensionId: contribution.id });
      }
    }
    for (const feature of registry) {
      const visit = (id: string, path: Set<string>) => {
        if (path.has(id))
          throw new HttpError(
            400,
            "feature_dependency_cycle",
            "Feature dependencies must not contain a cycle.",
          );
        const item = registry.find((entry) => entry.id === id);
        if (!item)
          throw new HttpError(
            400,
            "feature_dependency_missing",
            "An extension requires a missing feature.",
          );
        for (const dependency of item.dependencies) visit(dependency, new Set([...path, id]));
      };
      visit(feature.id, new Set());
    }
    this.registry = registry;
    this.extensionActive = isActive;
  }
  configuredEnabled(id: FeatureId): boolean {
    const feature = this.registry.find((f) => f.id === id);
    if (!feature) return false;
    return (
      (this.store.preference<Record<string, boolean>>("features", {})[id] ??
        feature.defaultEnabled) &&
      feature.dependencies.every((dependency) => this.configuredEnabled(dependency))
    );
  }
  enabled(id: FeatureId): boolean {
    const feature = this.registry.find((f) => f.id === id);
    return Boolean(
      feature &&
      this.configuredEnabled(id) &&
      (!feature.extensionId || this.extensionActive(feature.extensionId)) &&
      feature.dependencies.every((dependency) => this.enabled(dependency)),
    );
  }
  list() {
    return {
      features: this.registry.map((f) => ({ ...f, enabled: this.enabled(f.id) })),
      mode: this.store.preference("onboardingMode", "minimal"),
      onboardingComplete: this.store.preference("onboardingComplete", false),
    };
  }
  set(id: FeatureId, enabled: boolean) {
    const feature = this.registry.find((f) => f.id === id);
    if (!feature) throw new HttpError(400, "feature_unknown", "This feature is unavailable.");
    const values = this.store.preference<Record<string, boolean>>("features", {});
    values[id] = enabled;
    if (enabled) {
      const enableDependencies = (selected: typeof feature) => {
        for (const dependency of selected.dependencies) {
          values[dependency] = true;
          const nested = this.registry.find((f) => f.id === dependency);
          if (nested) enableDependencies(nested);
        }
      };
      enableDependencies(feature);
    } else
      for (const dependent of this.registry)
        if ((dependent.dependencies as readonly string[]).includes(id))
          values[dependent.id] = false;
    this.store.setPreference("features", values);
    return this.list();
  }
  require(id: FeatureId) {
    if (!this.enabled(id))
      throw new HttpError(
        403,
        "feature_disabled",
        `${this.registry.find((f) => f.id === id)?.name ?? "This feature"} is disabled or its extension is unavailable in Headful settings.`,
      );
  }
}
export class FeatureService extends Context.Service<
  FeatureService,
  { readonly features: FeatureManager }
>()("t3/headful/FeatureService") {}
const make = Effect.gen(function* () {
  const { store } = yield* Store.Store;
  return FeatureService.of({ features: new FeatureManager(store) });
});
export const layer = Layer.effect(FeatureService, make);
