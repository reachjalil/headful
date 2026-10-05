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
import { headfulExtensionManifestSchema } from "../../../../../packages/contracts/src/headful-extensions.ts";
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
    ).rejects.toMatchObject({ code: "plugin_missing" });
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
    ).rejects.toMatchObject({ code: "plugin_setting_invalid" });
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
    ).rejects.toMatchObject({ code: "plugin_command_input" });
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
    ).rejects.toMatchObject({ code: "plugin_disabled" });
    await expect(
      first.state.context!.runtime.dispatch("status", {}, desktop),
    ).rejects.toMatchObject({ code: "plugin_stopped" });
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
    ).rejects.toMatchObject({ code: "plugin_incompatible" });
    await expect(
      c.runtime.dispatch("extensions.enable", { id: "absent" }, desktop),
    ).rejects.toMatchObject({ code: "plugin_missing" });
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
    ).rejects.toMatchObject({ code: "plugin_operation_denied" });
    await expect(
      port.dispatch("createUser" as never, {} as never, {
        kind: "mcp",
        clientId: "forged",
        orgIds: [],
        scopes: ["headful:read", "headful:propose"],
      }),
    ).rejects.toMatchObject({ code: "plugin_operation_denied" });
    await expect(port.dispatch("orgs.remove" as never, {} as never, desktop)).rejects.toMatchObject(
      { code: "plugin_operation_denied" },
    );
    expect("close" in port).toBe(false);
    expect(c.session).not.toHaveBeenCalled();
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
    ).rejects.toMatchObject({ code: "plugin_disabled" });
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
});
