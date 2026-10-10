import type {
  HeadfulModContext,
  HeadfulModManifest,
} from "../../../../../packages/contracts/src/headful-mods.ts";
import { ModError, serializable, type Value } from "../../../../../packages/mod-sdk/src/schema.ts";
import type { ModManager } from "./ModManager.ts";
import type { LocalStore } from "../Store.ts";
/** Community broker never accepts mod id, Salesforce authority, native paths or raw transport. */
export function createModBroker(store: () => LocalStore, manager: () => ModManager) {
  return async (
    context: HeadfulModContext,
    manifest: HeadfulModManifest,
    method: string,
    input: Value,
  ): Promise<Value> => {
    context.requireActive();
    const description = manager().inspect(context.modId),
      granted = description.grantedPermissions;
    const requirePermission = (permission: string) => {
      if (
        !granted.includes(permission) ||
        ![...manifest.permissions, ...manifest.optionalPermissions].includes(permission)
      )
        throw new ModError(
          "permission_denied",
          "Permission is not currently granted: " + permission,
        );
    };
    const object = input && typeof input === "object" && !Array.isArray(input) ? input : null;
    if (method === "settings.get") {
      requirePermission("local:settings");
      return serializable(context.settings.get());
    }
    if (method === "settings.set") {
      requirePermission("local:settings");
      if (!object) throw new ModError("input_invalid", "Expected settings object.");
      context.settings.set(object as never);
      return serializable(context.settings.get());
    }
    if (method === "storage.get" || method === "storage.set") {
      requirePermission("local:storage");
      if (
        !object ||
        typeof object.key !== "string" ||
        !/^[a-z0-9._-]{1,80}$/.test(object.key) ||
        Object.keys(object).some((k) => !["key", "value"].includes(k))
      )
        throw new ModError("input_invalid", "Expected a scoped storage key.");
      const key = "mod:" + context.modId + ":storage",
        values = store().preference<Record<string, Value>>(key, {});
      if (method === "storage.get") return values[object.key] ?? null;
      if (!Object.hasOwn(object, "value"))
        throw new ModError("input_invalid", "Storage value required.");
      values[object.key] = serializable(object.value);
      if (
        Object.keys(values).length > 100 ||
        Buffer.byteLength(JSON.stringify(values)) > 1024 * 1024
      )
        throw new ModError("storage_quota", "Mod storage exceeds its 1 MiB / 100 key quota.");
      store().setPreference(key, values);
      return null;
    }
    if (method === "api") {
      requirePermission("mods:api");
      if (
        !object ||
        typeof object.id !== "string" ||
        !Object.hasOwn(object, "input") ||
        Object.keys(object).some((k) => !["id", "input"].includes(k))
      )
        throw new ModError("input_invalid", "Expected declared API and input.");
      const provider = manager()
        .list()
        .mods.find((m) => m.manifest.apis.some((a) => a.id === object.id));
      if (!provider) throw new ModError("api_missing", "API not installed.");
      if (provider.manifest.execution !== "community")
        throw new ModError(
          "api_authority_denied",
          "Community callers cannot use a native provider API.",
        );
      return serializable(
        await manager().api(provider.manifest.id, object.id, object.input, granted),
      );
    }
    // Salesforce operations remain behind the native adapter. No generic HTTP/CLI/FS/process operation.
    throw new ModError("capability_denied", "This host does not expose that community operation.");
  };
}
