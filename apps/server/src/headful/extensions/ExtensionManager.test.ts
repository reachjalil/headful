import { afterEach, describe, expect, it, vi } from "vite-plus/test";
// @effect-diagnostics-next-line nodeBuiltinImport:off - isolated extension fixture state.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off - isolated extension fixture state.
import { join } from "node:path";
import type {
  HeadfulExtensionContext,
  HeadfulExtensionDefinition,
} from "../../../../../packages/contracts/src/headful-extensions.ts";
import {
  headfulExtensionManifestSchema,
  resolveHeadfulContributions,
} from "../../../../../packages/contracts/src/headful-extensions.ts";
import { makeHeadfulRuntime, type HeadfulRuntime } from "../WorkspaceService.ts";
import { CliAdapter } from "../SalesforceCli.ts";
const desktop = { kind: "desktop" as const };
const runtimes: HeadfulRuntime[] = [],
  folders: string[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function fixture(
  id: string,
  options: {
    apiVersion?: number;
    defaultEnabled?: boolean;
    dependencies?: { id: string; version?: string }[];
    requiredFeatures?: string[];
    disposeTrace?: string[];
  } = {},
) {
  const state = {
    activated: 0,
    disposed: 0,
    hooks: [] as string[],
    context: null as HeadfulExtensionContext | null,
    recovery: 0,
  };
  const definition: HeadfulExtensionDefinition = {
    manifest: {
      schemaVersion: 1,
      apiVersion: options.apiVersion ?? 1,
      id,
      name: `Fixture ${id}`,
      description: "A trusted test extension.",
      packageName: `@headfulcloud/${id}`,
      version: "1.0.0",
      license: "MIT",
      source: "bundled",
      defaultEnabled: options.defaultEnabled ?? false,
      dependencies: options.dependencies ?? [],
      requiredFeatures: options.requiredFeatures ?? [],
      permissions: ["salesforce:read", "salesforce:propose", "local:settings"],
      settings: [{ key: "summary", label: "Summary", type: "string", defaultValue: "local" }],
      contributions: {
        features: [
          {
            id: `${id}/reports`,
            name: "Fixture reports",
            description: "Optional fixture reports.",
            defaultEnabled: true,
            dependencies: ["org-management"],
            route: "extensions",
            lifecycle: "on-demand",
          },
        ],
        commands: [
          {
            id: "summary",
            name: "Summary",
            description: "Read local status.",
            parameters: [{ key: "prefix", type: "string" }],
          },
        ],
        surfaces: [{ id: "overview", name: "Overview", description: "Read a local summary." }],
        routes: [
          {
            id: "overview",
            name: "Overview",
            path: `/extensions/${id}/overview`,
            surfaceId: "overview",
          },
        ],
        hooks: ["activate", "deactivate", "feature-changed"],
        desktopOperations: [{ id: `${id}.recover`, recovery: true }],
      },
    },
    activate: async (context) => {
      context.requireActive();
      context.requireFeature(`${id}/reports`);
      const status = await context.runtime.dispatch("status", {}, desktop);
      expect(status.accountRequired).toBe(false);
      state.activated++;
      state.context = context;
      return {
        dispose: () => {
          state.disposed++;
          options.disposeTrace?.push(id);
        },
        onFeatureChange: async (event) => {
          const status = await context.runtime.dispatch("status", {}, desktop);
          state.hooks.push(`${event.id}:${status.local}`);
        },
        dispatchCommand: async (_, input) => {
          const status = await context.runtime.dispatch("status", {}, desktop);
          return {
            message: `${input.prefix ?? ""}${status.product}`,
            values: context.settings.get(),
          };
        },
        renderSurface: async () => ({
          title: "Local overview",
          markdown: "Headful keeps Salesforce credentials in your CLI.",
        }),
      };
    },
    recover: async () => {
      state.recovery++;
      return { recovered: true };
    },
  };
  return { definition, state };
}
function setup(definitions: HeadfulExtensionDefinition[], homeDir?: string) {
  const folder = homeDir ?? mkdtempSync(join(tmpdir(), "headful-extensions-"));
  if (!homeDir) folders.push(folder);
  const cli = new CliAdapter();
  const detect = vi.spyOn(cli, "detect"),
    session = vi.spyOn(cli, "session");
  const runtime = makeHeadfulRuntime({ homeDir: folder, cli, extensions: definitions });
  runtimes.push(runtime);
  return { runtime, folder, detect, session };
}
describe("trusted Headful extensions", () => {
  it("starts the account-free core without extensions or Salesforce side effects", async () => {
    const c = setup([]);
    const status = await c.runtime.dispatch("status", {}, desktop);
    expect(status.accountRequired).toBe(false);
    expect(status.features.some((feature) => feature.id === "local-mcp")).toBe(false);
    expect(await c.runtime.dispatch("extensions.list", {}, desktop)).toEqual({
      apiVersion: 1,
      extensions: [],
    });
    expect(c.detect).not.toHaveBeenCalled();
    expect(c.session).not.toHaveBeenCalled();
    await expect(
      c.runtime.extensions.handleMcp(new Request("http://localhost/mcp")),
    ).rejects.toMatchObject({ code: "extension_missing" });
  });
  it("activates independently, persists scoped settings and enablement, and disposes on disable", async () => {
    const first = fixture("insights"),
      second = fixture("notes");
    const c = setup([first.definition, second.definition]);
    await c.runtime.dispatch("status", {}, desktop);
    expect(first.state.activated).toBe(0);
    expect(second.state.activated).toBe(0);
    expect(
      (await c.runtime.dispatch("extensions.enable", { id: "insights" }, desktop)).status,
    ).toBe("active");
    expect(first.state.activated).toBe(1);
    expect(second.state.activated).toBe(0);
    await c.runtime.dispatch(
      "extensions.settings.set",
      { id: "insights", values: { summary: "chosen" } },
      desktop,
    );
    expect(
      await c.runtime.dispatch(
        "extensions.command",
        { id: "insights", command: "summary", input: { prefix: "Hello " } },
        desktop,
      ),
    ).toEqual({ message: "Hello Headful", values: { summary: "chosen" } });
    expect(await c.runtime.dispatch("extensions.settings", { id: "notes" }, desktop)).toEqual({
      id: "notes",
      values: { summary: "local" },
    });
    await expect(
      c.runtime.dispatch(
        "extensions.settings.set",
        { id: "insights", values: { secret: "unexpected" } },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "extension_setting_invalid" });
    await c.runtime.dispatch("features.set", { id: "launch-at-login", enabled: true }, desktop);
    expect(first.state.hooks).toEqual(["launch-at-login:true"]);
    expect(
      await c.runtime.dispatch(
        "extensions.surface",
        { id: "insights", surfaceId: "overview" },
        desktop,
      ),
    ).toMatchObject({ title: "Local overview" });
    await expect(
      c.runtime.dispatch(
        "extensions.command",
        { id: "insights", command: "summary", input: { shell: "anything" } },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "extension_command_input" });
    await c.runtime.close();
    const reopened = setup([first.definition, second.definition], c.folder);
    expect(
      (await reopened.runtime.dispatch("extensions.inspect", { id: "insights" }, desktop)).status,
    ).toBe("active");
    expect(
      await reopened.runtime.dispatch("extensions.settings", { id: "insights" }, desktop),
    ).toMatchObject({ values: { summary: "chosen" } });
    await reopened.runtime.dispatch("extensions.disable", { id: "insights" }, desktop);
    expect(first.state.context?.signal.aborted).toBe(true);
    expect(first.state.disposed).toBe(2);
    await expect(
      reopened.runtime.dispatch(
        "extensions.surface",
        { id: "insights", surfaceId: "overview" },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "extension_disabled" });
    await expect(
      first.state.context!.runtime.dispatch("status", {}, desktop),
    ).rejects.toMatchObject({ code: "extension_stopped" });
    expect(
      await reopened.runtime.extensions.dispatchDesktopIntegration("insights.recover", {}),
    ).toEqual({ recovered: true });
    expect(first.state.recovery).toBe(1);
  });
  it("blocks missing or incompatible dependencies and supports a second extension lifecycle", async () => {
    const disposed: string[] = [];
    const first = fixture("insights", { disposeTrace: disposed }),
      dependent = fixture("audit", {
        dependencies: [{ id: "insights", version: "1.0.0" }],
        disposeTrace: disposed,
      }),
      incompatible = fixture("future", { apiVersion: 2, defaultEnabled: true }),
      missing = fixture("missing", { defaultEnabled: true, dependencies: [{ id: "absent" }] });
    const c = setup([
      dependent.definition,
      first.definition,
      incompatible.definition,
      missing.definition,
    ]);
    const state = await c.runtime.dispatch("extensions.list", {}, desktop);
    expect(state.extensions.find((item) => item.manifest.id === "future")).toMatchObject({
      compatible: false,
      status: "incompatible",
    });
    expect(state.extensions.find((item) => item.manifest.id === "missing")).toMatchObject({
      status: "blocked",
    });
    expect((await c.runtime.dispatch("extensions.enable", { id: "audit" }, desktop)).status).toBe(
      "blocked",
    );
    expect(dependent.state.activated).toBe(0);
    await c.runtime.dispatch("extensions.enable", { id: "insights" }, desktop);
    expect(dependent.state.activated).toBe(1);
    await c.runtime.dispatch("extensions.disable", { id: "insights" }, desktop);
    expect(dependent.state.context?.signal.aborted).toBe(true);
    expect(dependent.state.disposed).toBe(1);
    expect(disposed).toEqual(["audit", "insights"]);
    expect((await c.runtime.dispatch("extensions.inspect", { id: "audit" }, desktop)).status).toBe(
      "blocked",
    );
    await expect(
      c.runtime.dispatch("extensions.enable", { id: "future" }, desktop),
    ).rejects.toMatchObject({ code: "extension_incompatible" });
    await expect(
      c.runtime.dispatch("extensions.enable", { id: "absent" }, desktop),
    ).rejects.toMatchObject({ code: "extension_missing" });
    expect(incompatible.state.activated).toBe(0);
    expect(missing.state.activated).toBe(0);
    expect(
      (await c.runtime.dispatch("status", {}, desktop)).features.find(
        (feature) => feature.id === "org-management",
      )?.enabled,
    ).toBe(true);
  });
  it("keeps approval, provider execution and org management outside extension authority", async () => {
    const first = fixture("insights", { defaultEnabled: true });
    const c = setup([first.definition]);
    await c.runtime.dispatch("status", {}, desktop);
    const port = first.state.context!.runtime;
    await expect(
      port.dispatch("reviewWorkflow" as never, {} as never, desktop),
    ).rejects.toMatchObject({ code: "extension_operation_denied" });
    await expect(
      port.dispatch("createUser" as never, {} as never, {
        kind: "mcp",
        clientId: "forged",
        orgIds: [],
        scopes: ["headful:read", "headful:propose"],
      }),
    ).rejects.toMatchObject({ code: "extension_operation_denied" });
    await expect(port.dispatch("orgs.remove" as never, {} as never, desktop)).rejects.toMatchObject(
      { code: "extension_operation_denied" },
    );
    expect("close" in port).toBe(false);
    expect(c.session).not.toHaveBeenCalled();
  });
  it("requires a narrow utility capability before invoking the CLI runtime port", async () => {
    const first = fixture("insights", { defaultEnabled: true });
    const c = setup([first.definition]);
    await c.runtime.dispatch("status", {}, desktop);
    await expect(
      first.state.context!.runtime.dispatch(
        "utilities.query.run",
        {
          orgId: "org_123456789012345",
          requestId: "request_12345",
          query: "SELECT Id FROM Account",
        },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "extension_permission_missing" });
    await expect(
      first.state.context!.runtime.dispatch(
        "utilities.org.open",
        {
          orgId: "org_123456789012345",
          destination: "setup",
        },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "extension_permission_missing" });
    expect(c.session).not.toHaveBeenCalled();
  });
  it("keeps disabled-state recovery limited to local cleanup and native metadata", async () => {
    const subject = fixture("insights");
    const definition: HeadfulExtensionDefinition = {
      ...subject.definition,
      async recover(context) {
        await expect(
          context.runtime.dispatch(
            "utilities.query.run",
            {
              orgId: "org_123456789012345",
              requestId: "request_12345",
              query: "SELECT Id FROM Account",
            },
            desktop,
          ),
        ).rejects.toMatchObject({ code: "extension_operation_denied" });
        await expect(
          context.runtime.dispatch("prepareUserCreation", {} as never, {
            kind: "mcp",
            clientId: "fixture_client_12345",
            orgIds: [],
            scopes: ["headful:read", "headful:propose"],
          }),
        ).rejects.toMatchObject({ code: "extension_operation_denied" });
        expect((await context.runtime.dispatch("status", {}, desktop)).local).toBe(true);
        return { recovered: true };
      },
    };
    const c = setup([definition]);
    expect(await c.runtime.extensions.dispatchDesktopIntegration("insights.recover", {})).toEqual({
      recovered: true,
    });
    expect(c.session).not.toHaveBeenCalled();
  });
  it("resolves namespaced native contributions from current features and extension lifecycle", async () => {
    const subject = fixture("insights", { defaultEnabled: true });
    const definition: HeadfulExtensionDefinition = {
      ...subject.definition,
      manifest: {
        ...subject.definition.manifest,
        contributions: {
          ...subject.definition.manifest.contributions,
          components: [
            { id: "insights/reports", kind: "panel" },
            { id: "insights/search", kind: "header-control" },
          ],
          navigation: [
            {
              id: "insights/reports",
              name: "Reports",
              componentId: "insights/reports",
              requiredFeatures: ["insights/reports"],
            },
          ],
          panels: [
            {
              id: "insights/reports",
              name: "Reports",
              componentId: "insights/reports",
              workspaceIds: ["insights/reports"],
              requiredFeatures: ["insights/reports"],
            },
          ],
          headerControls: [
            {
              id: "insights/search",
              name: "Search",
              componentId: "insights/search",
              requiredFeatures: ["insights/reports"],
            },
          ],
          commands: [
            {
              id: "insights/summary",
              name: "Summary",
              description: "Read status.",
              parameters: [],
              requiredFeatures: ["insights/reports"],
            },
          ],
          actions: [
            {
              id: "insights/summary",
              name: "Summary",
              commandId: "insights/summary",
              requiredFeatures: ["insights/reports"],
            },
          ],
        },
      },
    };
    const c = setup([definition]);
    const status = await c.runtime.dispatch("status", {}, desktop);
    const first = await c.runtime.dispatch("extensions.list", {}, desktop);
    const native = resolveHeadfulContributions(first.extensions, status.features);
    expect(native.navigation[0]).toMatchObject({
      available: true,
      contribution: { componentId: "insights/reports" },
    });
    expect(native.headerControls[0]?.available).toBe(true);
    expect(native.actions[0]?.available).toBe(true);
    await c.runtime.dispatch("features.set", { id: "insights/reports", enabled: false }, desktop);
    const changed = await c.runtime.dispatch("status", {}, desktop);
    const hidden = resolveHeadfulContributions(first.extensions, changed.features);
    expect(hidden.navigation[0]).toMatchObject({
      available: false,
      unavailableReason: "Enable insights/reports in Headful settings.",
    });
    expect(hidden.headerControls[0]?.available).toBe(false);
    await expect(
      c.runtime.dispatch(
        "extensions.command",
        { id: "insights", command: "insights/summary", input: {} },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "feature_disabled" });
    await c.runtime.dispatch("extensions.disable", { id: "insights" }, desktop);
    const disabled = await c.runtime.dispatch("extensions.list", {}, desktop);
    expect(
      resolveHeadfulContributions(disabled.extensions, changed.features).panels[0],
    ).toMatchObject({ available: false, unavailableReason: "Fixture insights is disabled." });
  });
  it("stops MCP exposure and lifecycle work when a required contributed feature is disabled", async () => {
    const subject = fixture("insights", { defaultEnabled: true });
    const handle = vi.fn(async () => Response.json({ local: true }));
    const definition: HeadfulExtensionDefinition = {
      ...subject.definition,
      manifest: {
        ...subject.definition.manifest,
        permissions: ["salesforce:read", "local:mcp-transport"],
        requiredFeatures: ["insights/reports"],
        contributions: {
          ...subject.definition.manifest.contributions,
          mcp: [
            {
              id: "local",
              transport: "streamable-http",
              path: "/mcp",
              requiredFeatures: ["insights/reports"],
            },
          ],
        },
      },
      activate: async (context) => ({
        ...(await subject.definition.activate(context)),
        handleMcp: handle,
      }),
    };
    const c = setup([definition]);
    expect((await c.runtime.extensions.handleMcp(new Request("http://localhost/mcp"))).status).toBe(
      200,
    );
    expect(handle).toHaveBeenCalledTimes(1);
    await c.runtime.dispatch("features.set", { id: "insights/reports", enabled: false }, desktop);
    expect(subject.state.disposed).toBe(1);
    expect(subject.state.context?.signal.aborted).toBe(true);
    await expect(
      c.runtime.extensions.handleMcp(new Request("http://localhost/mcp")),
    ).rejects.toMatchObject({ code: "extension_disabled" });
    expect(handle).toHaveBeenCalledTimes(1);
    expect(
      (await c.runtime.dispatch("extensions.inspect", { id: "insights" }, desktop)).status,
    ).toBe("blocked");
    await c.runtime.dispatch("features.set", { id: "insights/reports", enabled: true }, desktop);
    expect(subject.state.activated).toBe(2);
  });
  it("rejects manifest paths that escape a bundled extension", () => {
    const sample = fixture("insights").definition.manifest;
    expect(
      headfulExtensionManifestSchema.safeParse({
        ...sample,
        contributions: {
          skills: [{ id: "unsafe", name: "Unsafe", description: "", path: "./../secret" }],
        },
      }).success,
    ).toBe(false);
  });
  it("rejects cross-extension IDs and undeclared or mismatched native component references", () => {
    const sample = fixture("insights").definition.manifest;
    const components = [{ id: "insights/reports", kind: "panel" }];
    expect(
      headfulExtensionManifestSchema.safeParse({
        ...sample,
        contributions: {
          components,
          navigation: [{ id: "other/reports", name: "Reports", componentId: "insights/reports" }],
        },
      }).success,
    ).toBe(false);
    expect(
      headfulExtensionManifestSchema.safeParse({
        ...sample,
        contributions: {
          components,
          headerControls: [
            { id: "insights/search", name: "Search", componentId: "insights/reports" },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      headfulExtensionManifestSchema.safeParse({
        ...sample,
        contributions: {
          actions: [{ id: "insights/execute", name: "Execute", commandId: "insights/undeclared" }],
        },
      }).success,
    ).toBe(false);
    expect(
      headfulExtensionManifestSchema.safeParse({
        ...sample,
        entryPoints: { server: "./../private.js" },
      }).success,
    ).toBe(false);
  });
});

describe("native status, event and capability contributions", () => {
  it("publishes only declared bounded status and removes listeners/capabilities on disposal", async () => {
    const f = fixture("contributions", { defaultEnabled: true });
    const definition: HeadfulExtensionDefinition = {
      ...f.definition,
      manifest: {
        ...f.definition.manifest,
        contributions: {
          ...f.definition.manifest.contributions,
          statuses: [{ id: "connection", name: "Connection" }],
          events: ["default-org-changed"],
          capabilities: [{ id: "contributions/reader", operations: ["status"] }],
        },
      },
    };
    const c = setup([definition]);
    await c.runtime.dispatch("status", {}, desktop);
    const context = f.state.context!;
    const events: string[] = [];
    context.events.subscribe((event) => {
      events.push(event.type);
    });
    const port = context.capabilities.register("contributions/reader");
    expect((await port.dispatch("status", {}, desktop)).product).toBe("Headful");
    expect(() => port.dispatch("listOrgs", {}, desktop)).toThrow(
      "outside the registered capability",
    );
    expect(() =>
      context.status.publish({ id: "undeclared", state: "online", label: "Hidden" }),
    ).toThrow("declared");
    context.status.publish({
      id: "connection",
      state: "online",
      label: "Connected",
      clientCount: 1,
    });
    expect(c.runtime.extensions.inspect("contributions").runtimeStatuses[0]?.clientCount).toBe(1);
    await c.runtime.extensions.publishEvent({ type: "default-org-changed", orgId: null });
    await c.runtime.extensions.publishEvent({ type: "org-policy-changed", orgId: "unrelated" });
    expect(events).toEqual(["default-org-changed"]);
    await c.runtime.dispatch("extensions.disable", { id: "contributions" }, desktop);
    await c.runtime.extensions.publishEvent({ type: "default-org-changed", orgId: null });
    expect(events).toHaveLength(1);
    expect(c.runtime.extensions.inspect("contributions").registeredCapabilities).toEqual([]);
    expect(c.runtime.extensions.inspect("contributions").runtimeStatuses).toEqual([]);
    expect(() => port.dispatch("status", {}, desktop)).toThrow("stopped");
  });
});
