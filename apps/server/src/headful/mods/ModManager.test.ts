import { afterEach, describe, expect, it, vi } from "vite-plus/test";
// @effect-diagnostics-next-line nodeBuiltinImport:off - isolated mod fixture state.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off - isolated mod fixture state.
import * as NodePath from "node:path";
import type {
  HeadfulModContext,
  HeadfulModDefinition,
} from "../../../../../packages/contracts/src/headful-mods.ts";
import {
  headfulModManifestSchema,
  resolveHeadfulContributions,
} from "../../../../../packages/contracts/src/headful-mods.ts";
import { makeHeadfulRuntime, type HeadfulRuntime } from "../WorkspaceService.ts";
import { CliAdapter } from "../SalesforceCli.ts";
const desktop = { kind: "desktop" as const };
const runtimes: HeadfulRuntime[] = [],
  folders: string[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const folder of folders.splice(0)) NodeFS.rmSync(folder, { recursive: true, force: true });
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
    context: null as HeadfulModContext | null,
    recovery: 0,
  };
  const definition: HeadfulModDefinition = {
    nativeTrusted: true,
    hostPermissions: [
      "salesforce:read",
      "salesforce:propose",
      "local:settings",
      "local:mcp-transport",
      "host:events",
    ],
    manifest: {
      schemaVersion: 1,
      execution: "native",
      apiVersion: options.apiVersion ?? 1,
      id,
      name: `Fixture ${id}`,
      description: "A trusted test mod.",
      version: "1.0.0",
      license: "MIT",
      source: "bundled",
      defaultEnabled: options.defaultEnabled ?? false,
      dependencies: (options.dependencies ?? []).map((d) => ({
        ...d,
        version: d.version ?? "^1.0.0",
      })),
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
            route: "mods",
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
            path: `/mods/${id}/overview`,
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
function setup(definitions: HeadfulModDefinition[], homeDir?: string) {
  const folder = homeDir ?? NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "headful-mods-"));
  if (!homeDir) folders.push(folder);
  const cli = new CliAdapter();
  const detect = vi.spyOn(cli, "detect"),
    session = vi.spyOn(cli, "session");
  const runtime = makeHeadfulRuntime({ homeDir: folder, cli, mods: definitions });
  runtimes.push(runtime);
  return { runtime, folder, detect, session };
}
describe("trusted Headful mods", () => {
  it("starts the account-free core without mods or Salesforce side effects", async () => {
    const c = setup([]);
    const status = await c.runtime.dispatch("status", {}, desktop);
    expect(status.accountRequired).toBe(false);
    expect(status.features.some((feature) => feature.id === "local-mcp")).toBe(false);
    expect(await c.runtime.dispatch("mods.list", {}, desktop)).toEqual({
      apiVersion: 1,
      mods: [],
    });
    expect(c.detect).not.toHaveBeenCalled();
    expect(c.session).not.toHaveBeenCalled();
    await expect(
      c.runtime.mods.handleMcp(new Request("http://localhost/mcp")),
    ).rejects.toMatchObject({ code: "mod_missing" });
  });
  it("activates independently, persists scoped settings and enablement, and disposes on disable", async () => {
    const first = fixture("example.insights"),
      second = fixture("example.notes");
    const c = setup([first.definition, second.definition]);
    await c.runtime.dispatch("status", {}, desktop);
    expect(first.state.activated).toBe(0);
    expect(second.state.activated).toBe(0);
    expect(
      (await c.runtime.dispatch("mods.enable", { id: "example.insights" }, desktop)).status,
    ).toBe("inactive");
    await c.runtime.mods.activateFeature("example.insights/reports");
    expect(first.state.activated).toBe(1);
    expect(second.state.activated).toBe(0);
    await c.runtime.dispatch(
      "mods.settings.set",
      { id: "example.insights", values: { summary: "chosen" } },
      desktop,
    );
    expect(
      await c.runtime.dispatch(
        "mods.command",
        { id: "example.insights", command: "summary", input: { prefix: "Hello " } },
        desktop,
      ),
    ).toEqual({ message: "Hello Headful", values: { summary: "chosen" } });
    expect(await c.runtime.dispatch("mods.settings", { id: "example.notes" }, desktop)).toEqual({
      id: "example.notes",
      values: { summary: "local" },
    });
    await expect(
      c.runtime.dispatch(
        "mods.settings.set",
        { id: "example.insights", values: { secret: "unexpected" } },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "mod_setting_invalid" });
    await c.runtime.dispatch("features.set", { id: "launch-at-login", enabled: true }, desktop);
    expect(first.state.hooks).toEqual(["launch-at-login:true"]);
    expect(
      await c.runtime.dispatch(
        "mods.surface",
        { id: "example.insights", surfaceId: "overview" },
        desktop,
      ),
    ).toMatchObject({ title: "Local overview" });
    await expect(
      c.runtime.dispatch(
        "mods.command",
        { id: "example.insights", command: "summary", input: { shell: "anything" } },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "mod_command_input" });
    await c.runtime.close();
    const reopened = setup([first.definition, second.definition], c.folder);
    await reopened.runtime.mods.activateFeature("example.insights/reports");
    expect(
      (await reopened.runtime.dispatch("mods.inspect", { id: "example.insights" }, desktop)).status,
    ).toBe("active");
    expect(
      await reopened.runtime.dispatch("mods.settings", { id: "example.insights" }, desktop),
    ).toMatchObject({ values: { summary: "chosen" } });
    await reopened.runtime.dispatch("mods.disable", { id: "example.insights" }, desktop);
    expect(first.state.context?.signal.aborted).toBe(true);
    expect(first.state.disposed).toBe(2);
    await expect(
      reopened.runtime.dispatch(
        "mods.surface",
        { id: "example.insights", surfaceId: "overview" },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "mod_disabled" });
    await expect(
      first.state.context!.runtime.dispatch("status", {}, desktop),
    ).rejects.toMatchObject({ code: "mod_stopped" });
    expect(
      await reopened.runtime.mods.dispatchDesktopIntegration("example.insights.recover", {}),
    ).toEqual({ recovered: true });
    expect(first.state.recovery).toBe(1);
  });
  it("blocks missing or incompatible dependencies and supports a second mod lifecycle", async () => {
    const disposed: string[] = [];
    const first = fixture("example.insights", { disposeTrace: disposed }),
      dependent = fixture("example.audit", {
        dependencies: [{ id: "example.insights", version: "1.0.0" }],
        disposeTrace: disposed,
      }),
      incompatible = fixture("example.future", { apiVersion: 2, defaultEnabled: true }),
      missing = fixture("example.missing", {
        defaultEnabled: true,
        dependencies: [{ id: "example.absent" }],
      });
    const c = setup([
      dependent.definition,
      first.definition,
      incompatible.definition,
      missing.definition,
    ]);
    const state = await c.runtime.dispatch("mods.list", {}, desktop);
    expect(state.mods.find((item) => item.manifest.id === "example.future")).toMatchObject({
      compatible: false,
      status: "incompatible",
    });
    expect(state.mods.find((item) => item.manifest.id === "example.missing")).toMatchObject({
      status: "blocked",
    });
    expect((await c.runtime.dispatch("mods.enable", { id: "example.audit" }, desktop)).status).toBe(
      "blocked",
    );
    expect(dependent.state.activated).toBe(0);
    await c.runtime.dispatch("mods.enable", { id: "example.insights" }, desktop);
    await c.runtime.mods.activateFeature("example.audit/reports");
    expect(dependent.state.activated).toBe(1);
    await c.runtime.dispatch("mods.disable", { id: "example.insights" }, desktop);
    expect(dependent.state.context?.signal.aborted).toBe(true);
    expect(dependent.state.disposed).toBe(1);
    expect(disposed).toEqual(["example.audit", "example.insights"]);
    expect(
      (await c.runtime.dispatch("mods.inspect", { id: "example.audit" }, desktop)).status,
    ).toBe("blocked");
    await expect(
      c.runtime.dispatch("mods.enable", { id: "example.future" }, desktop),
    ).rejects.toMatchObject({ code: "mod_incompatible" });
    await expect(
      c.runtime.dispatch("mods.enable", { id: "example.absent" }, desktop),
    ).rejects.toMatchObject({ code: "mod_missing" });
    expect(incompatible.state.activated).toBe(0);
    expect(missing.state.activated).toBe(0);
    expect(
      (await c.runtime.dispatch("status", {}, desktop)).features.find(
        (feature) => feature.id === "org-management",
      )?.enabled,
    ).toBe(true);
  });
  it("keeps approval, provider execution and org management outside mod authority", async () => {
    const first = fixture("example.insights", { defaultEnabled: true });
    const c = setup([first.definition]);
    await c.runtime.dispatch("status", {}, desktop);
    await c.runtime.mods.activateFeature("example.insights/reports");
    const port = first.state.context!.runtime;
    await expect(
      port.dispatch("reviewWorkflow" as never, {} as never, desktop),
    ).rejects.toMatchObject({ code: "mod_operation_denied" });
    await expect(
      port.dispatch("createUser" as never, {} as never, {
        kind: "mcp",
        clientId: "forged",
        orgIds: [],
        scopes: ["headful:read", "headful:propose"],
      }),
    ).rejects.toMatchObject({ code: "mod_operation_denied" });
    await expect(port.dispatch("orgs.remove" as never, {} as never, desktop)).rejects.toMatchObject(
      { code: "mod_operation_denied" },
    );
    expect("close" in port).toBe(false);
    expect(c.session).not.toHaveBeenCalled();
  });
  it("requires a narrow utility capability before invoking the CLI runtime port", async () => {
    const first = fixture("example.insights", { defaultEnabled: true });
    const c = setup([first.definition]);
    await c.runtime.dispatch("status", {}, desktop);
    await c.runtime.mods.activateFeature("example.insights/reports");
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
    ).rejects.toMatchObject({ code: "mod_permission_missing" });
    await c.runtime.mods.activateFeature("example.insights/reports");
    await expect(
      first.state.context!.runtime.dispatch(
        "utilities.org.open",
        {
          orgId: "org_123456789012345",
          destination: "setup",
        },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "mod_permission_missing" });
    expect(c.session).not.toHaveBeenCalled();
  });
  it("keeps disabled-state recovery limited to local cleanup and native metadata", async () => {
    const subject = fixture("example.insights");
    const definition: HeadfulModDefinition = {
      nativeTrusted: true,
      hostPermissions: [
        "salesforce:read",
        "salesforce:propose",
        "local:settings",
        "local:mcp-transport",
        "host:events",
      ],
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
        ).rejects.toMatchObject({ code: "mod_operation_denied" });
        await expect(
          context.runtime.dispatch("prepareUserCreation", {} as never, {
            kind: "mcp",
            clientId: "fixture_client_12345",
            orgIds: [],
            scopes: ["headful:read", "headful:propose"],
          }),
        ).rejects.toMatchObject({ code: "mod_operation_denied" });
        expect((await context.runtime.dispatch("status", {}, desktop)).local).toBe(true);
        return { recovered: true };
      },
    };
    const c = setup([definition]);
    expect(await c.runtime.mods.dispatchDesktopIntegration("example.insights.recover", {})).toEqual(
      {
        recovered: true,
      },
    );
    expect(c.session).not.toHaveBeenCalled();
  });
  it("resolves namespaced native contributions from current features and mod lifecycle", async () => {
    const subject = fixture("example.insights", { defaultEnabled: true });
    const definition: HeadfulModDefinition = {
      nativeTrusted: true,
      hostPermissions: [
        "salesforce:read",
        "salesforce:propose",
        "local:settings",
        "local:mcp-transport",
        "host:events",
      ],
      ...subject.definition,
      manifest: {
        ...subject.definition.manifest,
        contributions: {
          ...subject.definition.manifest.contributions,
          components: [
            { id: "example.insights/reports", kind: "panel" },
            { id: "example.insights/search", kind: "header-control" },
          ],
          navigation: [
            {
              id: "example.insights/reports",
              name: "Reports",
              componentId: "example.insights/reports",
              requiredFeatures: ["example.insights/reports"],
            },
          ],
          panels: [
            {
              id: "example.insights/reports",
              name: "Reports",
              componentId: "example.insights/reports",
              workspaceIds: ["example.insights/reports"],
              requiredFeatures: ["example.insights/reports"],
            },
          ],
          headerControls: [
            {
              id: "example.insights/search",
              name: "Search",
              componentId: "example.insights/search",
              requiredFeatures: ["example.insights/reports"],
            },
          ],
          commands: [
            {
              id: "example.insights/summary",
              name: "Summary",
              description: "Read status.",
              parameters: [],
              requiredFeatures: ["example.insights/reports"],
            },
          ],
          actions: [
            {
              id: "example.insights/summary",
              name: "Summary",
              commandId: "example.insights/summary",
              requiredFeatures: ["example.insights/reports"],
            },
          ],
        },
      },
    };
    const c = setup([definition]);
    const dormant = await c.runtime.dispatch("mods.list", {}, desktop);
    const configured = await c.runtime.dispatch("features.list", {}, desktop);
    expect(
      configured.features.find((feature) => feature.id === "example.insights/reports"),
    ).toMatchObject({ enabled: false, configuredEnabled: true });
    expect(
      resolveHeadfulContributions(dormant.mods, configured.features).navigation[0]?.available,
    ).toBe(true);
    expect(subject.state.activated).toBe(0);
    await c.runtime.mods.activateFeature("example.insights/reports");
    const status = await c.runtime.dispatch("status", {}, desktop);
    const first = await c.runtime.dispatch("mods.list", {}, desktop);
    const native = resolveHeadfulContributions(first.mods, status.features);
    expect(native.navigation[0]).toMatchObject({
      available: true,
      contribution: { componentId: "example.insights/reports" },
    });
    expect(native.headerControls[0]?.available).toBe(true);
    expect(native.actions[0]?.available).toBe(true);
    await c.runtime.dispatch(
      "features.set",
      { id: "example.insights/reports", enabled: false },
      desktop,
    );
    const changed = await c.runtime.dispatch("status", {}, desktop);
    const hidden = resolveHeadfulContributions(first.mods, changed.features);
    expect(hidden.navigation[0]).toMatchObject({
      available: false,
      unavailableReason: "Enable example.insights/reports in Headful settings.",
    });
    expect(hidden.headerControls[0]?.available).toBe(false);
    await expect(
      c.runtime.dispatch(
        "mods.command",
        { id: "example.insights", command: "example.insights/summary", input: {} },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "feature_disabled" });
    await c.runtime.dispatch("mods.disable", { id: "example.insights" }, desktop);
    const disabled = await c.runtime.dispatch("mods.list", {}, desktop);
    expect(resolveHeadfulContributions(disabled.mods, changed.features).panels[0]).toMatchObject({
      available: false,
      unavailableReason: "Fixture example.insights is disabled.",
    });
  });
  it("rejects editor commands and views from a replaced artifact before invoking replacement code", async () => {
    const subject = fixture("example.revision", { defaultEnabled: true });
    const first = { ...subject.definition, artifactRevision: "revision-one" };
    const c = setup([first]);
    await c.runtime.dispatch("mods.list", {}, desktop);
    await c.runtime.mods.replaceDefinitions([{ ...first, artifactRevision: "revision-two" }]);
    await expect(
      c.runtime.dispatch(
        "mods.command",
        { id: "example.revision", command: "summary", input: {}, artifactRevision: "revision-one" },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "mod_revision_changed" });
    await expect(
      c.runtime.dispatch(
        "mods.surface",
        { id: "example.revision", surfaceId: "overview", artifactRevision: "revision-one" },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "mod_revision_changed" });
    expect(subject.state.activated).toBe(0);
    await c.runtime.dispatch(
      "mods.surface",
      { id: "example.revision", surfaceId: "overview", artifactRevision: "revision-two" },
      desktop,
    );
    expect(subject.state.activated).toBe(1);
  });
  it("stops MCP exposure and lifecycle work when a required contributed feature is disabled", async () => {
    const subject = fixture("example.insights", { defaultEnabled: true });
    const handle = vi.fn(async () => Response.json({ local: true }));
    const definition: HeadfulModDefinition = {
      nativeTrusted: true,
      hostPermissions: [
        "salesforce:read",
        "salesforce:propose",
        "local:settings",
        "local:mcp-transport",
        "host:events",
      ],
      ...subject.definition,
      manifest: {
        ...subject.definition.manifest,
        permissions: ["salesforce:read", "local:mcp-transport"],
        requiredFeatures: ["example.insights/reports"],
        contributions: {
          ...subject.definition.manifest.contributions,
          mcp: [
            {
              id: "local",
              transport: "streamable-http",
              path: "/mcp",
              requiredFeatures: ["example.insights/reports"],
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
    expect((await c.runtime.mods.handleMcp(new Request("http://localhost/mcp"))).status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
    await c.runtime.dispatch(
      "features.set",
      { id: "example.insights/reports", enabled: false },
      desktop,
    );
    expect(subject.state.disposed).toBe(1);
    expect(subject.state.context?.signal.aborted).toBe(true);
    await expect(
      c.runtime.mods.handleMcp(new Request("http://localhost/mcp")),
    ).rejects.toMatchObject({ code: "mod_disabled" });
    expect(handle).toHaveBeenCalledTimes(1);
    expect(
      (await c.runtime.dispatch("mods.inspect", { id: "example.insights" }, desktop)).status,
    ).toBe("blocked");
    await c.runtime.dispatch(
      "features.set",
      { id: "example.insights/reports", enabled: true },
      desktop,
    );
    expect(subject.state.activated).toBe(2);
  });
  it("rejects manifest paths that escape a bundled mod", () => {
    const sample = fixture("example.insights").definition.manifest;
    expect(
      headfulModManifestSchema.safeParse({
        ...sample,
        contributions: {
          skills: [{ id: "unsafe", name: "Unsafe", description: "", path: "./../secret" }],
        },
      }).success,
    ).toBe(false);
  });
  it("rejects cross-mod IDs and undeclared or mismatched native component references", () => {
    const sample = fixture("example.insights").definition.manifest;
    const components = [{ id: "example.insights/reports", kind: "panel" }];
    expect(
      headfulModManifestSchema.safeParse({
        ...sample,
        contributions: {
          components,
          navigation: [
            { id: "other/reports", name: "Reports", componentId: "example.insights/reports" },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      headfulModManifestSchema.safeParse({
        ...sample,
        contributions: {
          components,
          headerControls: [
            {
              id: "example.insights/search",
              name: "Search",
              componentId: "example.insights/reports",
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      headfulModManifestSchema.safeParse({
        ...sample,
        contributions: {
          actions: [
            {
              id: "example.insights/execute",
              name: "Execute",
              commandId: "example.insights/undeclared",
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      headfulModManifestSchema.safeParse({
        ...sample,
        entryPoints: { server: "./../private.js" },
      }).success,
    ).toBe(false);
  });
});

describe("native status, event and capability contributions", () => {
  it("publishes only declared bounded status and removes listeners/capabilities on disposal", async () => {
    const f = fixture("example.contributions", { defaultEnabled: true });
    const definition: HeadfulModDefinition = {
      nativeTrusted: true,
      hostPermissions: [
        "salesforce:read",
        "salesforce:propose",
        "local:settings",
        "local:mcp-transport",
        "host:events",
      ],
      ...f.definition,
      manifest: {
        ...f.definition.manifest,
        contributions: {
          ...f.definition.manifest.contributions,
          statuses: [{ id: "connection", name: "Connection" }],
          events: ["default-org-changed"],
          capabilities: [{ id: "example.contributions/reader", operations: ["status"] }],
        },
      },
    };
    const c = setup([definition]);
    await c.runtime.dispatch("status", {}, desktop);
    await c.runtime.mods.activateFeature("example.contributions/reports");
    const context = f.state.context!;
    const events: string[] = [];
    context.events.subscribe((event) => {
      events.push(event.type);
    });
    const port = context.capabilities.register("example.contributions/reader");
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
    expect(c.runtime.mods.inspect("example.contributions").runtimeStatuses[0]?.clientCount).toBe(1);
    await c.runtime.mods.publishEvent({ type: "default-org-changed", orgId: null });
    await c.runtime.mods.publishEvent({ type: "org-policy-changed", orgId: "unrelated" });
    expect(events).toEqual(["default-org-changed"]);
    await c.runtime.dispatch("mods.disable", { id: "example.contributions" }, desktop);
    await c.runtime.mods.publishEvent({ type: "default-org-changed", orgId: null });
    expect(events).toHaveLength(1);
    expect(c.runtime.mods.inspect("example.contributions").registeredCapabilities).toEqual([]);
    expect(c.runtime.mods.inspect("example.contributions").runtimeStatuses).toEqual([]);
    expect(() => port.dispatch("status", {}, desktop)).toThrow("stopped");
  });
});
