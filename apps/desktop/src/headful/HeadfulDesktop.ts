// @effect-diagnostics nodeBuiltinImport:off globalFetch:off preferSchemaOverJson:off
import * as Effect from "effect/Effect";
import { HostProcessArchitecture } from "@t3tools/shared/hostProcess";
import * as Option from "effect/Option";
import * as Electron from "electron";
import * as NodeFSP from "node:fs/promises";
import { readRuntimeSession } from "./RuntimeSession.ts";
import * as NodePath from "node:path";
import { ModSandboxHost } from "./ModSandbox.ts";
import { startDesktopControl } from "./DesktopControl.ts";
import { signDesktopRequest } from "./DesktopCapability.ts";
import { headfulResultSchemas } from "@t3tools/contracts/headful";
import {
  headfulModsSchema,
  resolveHeadfulContributions,
  type HeadfulModDescriptor,
} from "@t3tools/contracts/headful-mods";
import { locationSchema } from "@t3tools/contracts/headful-workspace/contract-schema";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";

interface LocalSession {
  origin: string;
  pid: number;
}
interface TrayOrg {
  id: string;
  label: string;
  status: string;
  isSandbox: boolean | null;
  instanceOrigin: string;
  color?: string;
  agentEnabled?: boolean;
  remoteEnabled?: boolean;
}
const safeOrigin = (value: string) => /^http:\/\/127\.0\.0\.1:\d+$/.test(value);
let pendingRoute: string | undefined;
let rendererReady = false;
let deliverLink: ((value: string) => void) | undefined;
const initialLinks: string[] = [];
const onOpenUrl = (event: Electron.Event, value: string) => {
  if (!value.startsWith("headful://workspace")) return;
  event.preventDefault();
  if (deliverLink) deliverLink(value);
  else initialLinks.push(value);
};
// Capture cold-start URLs before the async Electron service graph reaches readiness.
Electron.app.on("open-url", onOpenUrl);
export const ensureSingleInstance = Effect.sync(() => {
  if (!Electron.app.requestSingleInstanceLock()) Electron.app.exit(0);
});
export const register = Effect.gen(function* () {
  const architecture = yield* HostProcessArchitecture;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const context = yield* Effect.context<DesktopWindow.DesktopWindow>();
  const run = Effect.runPromiseWith(context);
  const homeDir = NodePath.join(environment.stateDir, "headful");
  const control = yield* Effect.promise(() =>
    startDesktopControl(homeDir, !environment.isPackaged),
  );
  yield* Effect.addFinalizer(() => Effect.promise(() => control.close()));
  let buildCommit: string | undefined = Option.getOrUndefined(environment.commitHashOverride);
  if (environment.isPackaged) {
    const metadata: unknown = yield* Effect.promise(async () => {
      try {
        return JSON.parse(
          await NodeFSP.readFile(NodePath.join(environment.appRoot, "package.json"), "utf8"),
        );
      } catch {
        return null;
      }
    });
    if (
      metadata &&
      typeof metadata === "object" &&
      "t3codeCommitHash" in metadata &&
      typeof metadata.t3codeCommitHash === "string" &&
      /^[a-f0-9]{40}$/.test(metadata.t3codeCommitHash)
    )
      buildCommit = metadata.t3codeCommitHash;
  }
  const rpc = async (operation: string, input: unknown = {}): Promise<unknown> => {
    const session: LocalSession = JSON.parse(
      await readRuntimeSession(NodePath.join(homeDir, "desktop-session.json")),
    );
    if (!safeOrigin(session.origin)) throw new Error("Headful runtime unavailable.");
    const body = JSON.stringify({ operation, input });
    const response = await fetch(`${session.origin}/rpc`, {
      method: "POST",
      headers: {
        "X-Headful-Desktop-Signature": signDesktopRequest(body),
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(120_000),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const error = new Error(
        typeof payload === "object" &&
          payload &&
          "error" in payload &&
          typeof payload.error === "string"
          ? payload.error
          : "Headful operation failed.",
      );
      throw Object.assign(error, {
        code:
          typeof payload === "object" &&
          payload &&
          "code" in payload &&
          typeof payload.code === "string"
            ? payload.code
            : "operation_failed",
      });
    }
    if (!payload || typeof payload !== "object" || !("result" in payload))
      throw new Error("Invalid local service response.");
    return payload.result;
  };
  const sandbox = new ModSandboxHost(
    rpc,
    NodePath.join(
      environment.isPackaged ? environment.appRoot : environment.rootDir,
      "apps/desktop/dist-electron/mod-preload.cjs",
    ),
  );
  sandbox.start();
  yield* Effect.addFinalizer(() => Effect.sync(() => sandbox.close()));
  const open = async (route = "workspace") => {
    await run(desktopWindow.activate);
    const window = Electron.BrowserWindow.getAllWindows().find(
      (w) => !w.isDestroyed() && w.webContents.getURL().startsWith("headful"),
    );
    pendingRoute = route;
    if (rendererReady && window) {
      window.webContents.send("headful:navigate", route);
      pendingRoute = undefined;
    }
  };
  const trustedSender = (event: Electron.IpcMainInvokeEvent) =>
    event.senderFrame === event.sender.mainFrame &&
    /^headful(?:-dev)?:\/\/app\//.test(event.sender.getURL());
  const report = (error: unknown) =>
    Electron.dialog.showErrorBox(
      "Headful",
      error instanceof Error ? error.message : "The operation failed.",
    );
  const handle = async (event: Electron.IpcMainInvokeEvent, operation: unknown, input: unknown) => {
    if (!trustedSender(event) || typeof operation !== "string")
      throw new Error("Headful workspace required.");
    if (/^mods\.(?:execution|broker|grant|install|uninstall|deleteData|background)/.test(operation))
      throw new Error("Host-only operation.");
    if (operation === "system.mods.install") {
      const choice = await Electron.dialog.showOpenDialog({
        title: "Install a local Headful mod",
        properties: ["openFile"],
        filters: [{ name: "Headful mod", extensions: ["headfulmod"] }],
      });
      if (choice.canceled || !choice.filePaths[0]) return { canceled: true };
      const result = await rpc("mods.install", { path: choice.filePaths[0] });
      await refresh();
      return result;
    }
    if (operation === "system.mods.permissions") {
      const request = input as { id?: unknown };
      if (typeof request?.id !== "string") throw new Error("Select an installed mod.");
      const mod = headfulModsSchema
        .parse(await rpc("mods.list"))
        .mods.find((m) => m.manifest.id === request.id);
      if (!mod) throw new Error("Mod not installed.");
      const review = await Electron.dialog.showMessageBox({
        type: "question",
        title: "Review mod permissions",
        message: `Allow ${mod.manifest.name} ${mod.manifest.version}?`,
        detail: `Artifact ${mod.artifactRevision}\nExecution: ${mod.manifest.execution}\n\nRequired permissions:\n${mod.manifest.permissions.join("\n") || "None"}\nOptional:\n${mod.manifest.optionalPermissions.join("\n") || "None"}\n\nThese permissions do not approve Salesforce writes.`,
        buttons: [
          "Decline",
          "Allow required permissions",
          "Allow required and optional permissions",
        ],
        defaultId: 0,
        cancelId: 0,
      });
      if (review.response === 0) return { declined: true };
      return rpc("mods.grant", {
        id: mod.manifest.id,
        revision: mod.artifactRevision,
        permissions:
          review.response === 2
            ? [...mod.manifest.permissions, ...mod.manifest.optionalPermissions]
            : mod.manifest.permissions,
      });
    }
    if (operation === "system.mods.background") {
      const request = input as { id?: unknown };
      if (typeof request?.id !== "string") throw new Error("Select a mod.");
      const mod = headfulModsSchema
        .parse(await rpc("mods.list"))
        .mods.find((m) => m.manifest.id === request.id);
      if (!mod || !mod.manifest.activation.includes("background"))
        throw new Error("No background contribution.");
      const settings = (await rpc("mods.settings", { id: mod.manifest.id })) as { values: unknown };
      const review = await Electron.dialog.showMessageBox({
        type: "question",
        title: "Enable a background subscription",
        message: `Start ${mod.manifest.name} in the background?`,
        detail: `Artifact ${mod.artifactRevision}\nExact settings: ${JSON.stringify(settings.values)}\nIt remains subject to current grants. Disable the mod to stop it.`,
        buttons: ["Cancel", "Start"],
        defaultId: 0,
        cancelId: 0,
      });
      if (review.response !== 1) return { canceled: true };
      return rpc("mods.background", {
        id: mod.manifest.id,
        revision: mod.artifactRevision,
        settings: settings.values,
      });
    }
    if (operation === "system.mods.deleteData") {
      const request = input as { id?: unknown };
      if (typeof request?.id !== "string") throw new Error("Select a mod.");
      const review = await Electron.dialog.showMessageBox({
        type: "warning",
        title: "Delete mod data permanently",
        message: `Delete local data for ${request.id}?`,
        detail:
          "This disables the mod and permanently deletes only its settings, permission grant, private storage and local exports. Salesforce logins, orgs and durable workflows are preserved.",
        buttons: ["Cancel", "Delete mod data"],
        defaultId: 0,
        cancelId: 0,
      });
      if (review.response !== 1) return { canceled: true };
      return rpc("mods.deleteData", { id: request.id });
    }
    if (operation === "system.mods.uninstall") {
      const request = input as { id?: unknown };
      if (typeof request?.id !== "string") throw new Error("Select a mod.");
      const review = await Electron.dialog.showMessageBox({
        type: "question",
        title: "Uninstall mod",
        message: "Uninstall this mod?",
        detail: "Its private settings and storage are preserved.",
        buttons: ["Cancel", "Uninstall"],
        defaultId: 0,
        cancelId: 0,
      });
      if (review.response !== 1) return { canceled: true };
      return rpc("mods.uninstall", { id: request.id });
    }
    if (operation === "system.openInstaller") {
      await Electron.shell.openExternal(
        `https://developer.salesforce.com/media/salesforce-cli/sf/channels/stable/sf-${architecture === "arm64" ? "arm64" : "x64"}.pkg`,
      );
      return { opened: true };
    }
    if (operation === "system.launchAtLogin") {
      if (
        typeof input !== "object" ||
        input === null ||
        !("enabled" in input) ||
        typeof input.enabled !== "boolean"
      )
        throw new Error("Invalid setting.");
      Electron.app.setLoginItemSettings({ openAtLogin: input.enabled });
      return { enabled: Electron.app.getLoginItemSettings().openAtLogin };
    }
    if (operation === "system.about")
      return {
        version: "0.3.0",
        ...(buildCommit ? { buildCommit } : {}),
        upstreamVersion: "0.0.45",
        upstreamCommit: "efecd3cf8bcec3d1891b5f5a27dc2f6d797c6448",
        protocolVersion: 1,
        architecture: architecture,
        packaged: environment.isPackaged,
        updates: "Manual early-access builds; automatic updates disabled.",
      };
    if (operation === "system.openOrg") return rpc("orgs.open", input);

    const result = await rpc(operation, input);
    if (
      operation.startsWith("orgs.") ||
      operation.startsWith("features.") ||
      operation.startsWith("mods.")
    )
      await refresh();
    return result;
  };
  const receiveRoute = (value: string) => {
    try {
      const url = new URL(value);
      if (
        url.protocol !== "headful:" ||
        url.hostname !== "workspace" ||
        url.username ||
        url.password ||
        url.hash ||
        (url.pathname && url.pathname !== "/")
      )
        return;
      const allowed = new Set(["view", "orgId", "recordId", "workflowId", "proposalId"]);
      const keys = [...url.searchParams.keys()];
      if (
        keys.some((key) => !allowed.has(key)) ||
        new Set(keys).size !== keys.length ||
        value.length > 1000
      )
        return;
      if (!locationSchema.safeParse(Object.fromEntries(url.searchParams)).success) return;
      void open("workspace?" + url.searchParams.toString()).catch(report);
    } catch {
      /* Ignore malformed untrusted links. */
    }
  };
  deliverLink = receiveRoute;
  const onSecondInstance = (_event: Electron.Event, argv: string[]) => {
    for (const arg of argv) receiveRoute(arg);
  };
  Electron.app.on("second-instance", onSecondInstance);
  for (const link of initialLinks.splice(0)) receiveRoute(link);
  for (const arg of process.argv) receiveRoute(arg);
  Electron.ipcMain.handle("headful:dispatch", handle);
  Electron.ipcMain.handle("headful:routeReady", (event) => {
    if (!trustedSender(event)) throw new Error("Headful workspace required.");
    rendererReady = true;
    const route = pendingRoute;
    pendingRoute = undefined;
    return route;
  });
  for (const window of Electron.BrowserWindow.getAllWindows())
    window.webContents.on("did-start-loading", () => {
      rendererReady = false;
    });
  Electron.ipcMain.on("headful:open", (event, route: unknown) => {
    if (
      event.senderFrame === event.sender.mainFrame &&
      typeof route === "string" &&
      /^headful(?:-dev)?:\/\/app\//.test(event.sender.getURL())
    )
      void open(route);
  });
  const iconRoot = NodePath.join(
    environment.isPackaged ? environment.resourcesPath : environment.rootDir,
    environment.isPackaged ? "headful" : "assets/headful",
  );
  const icon = (color = "template") => {
    const mapped =
      (
        {
          "#626dd2": "violet",
          "#626dcc": "violet",
          "#d4ed8b": "lime",
          "#257bc0": "blue",
          "#c8751c": "orange",
          "#bc4475": "rose",
        } as Record<string, string>
      )[color] || color;
    const known = ["violet", "lime", "blue", "orange", "rose", "template"].includes(mapped)
      ? mapped
      : "violet";
    let image = Electron.nativeImage
      .createFromPath(NodePath.join(iconRoot, `tray-${known}.png`))
      .resize({ width: 22, height: 22 });
    if (/^#[a-fA-F0-9]{6}$/.test(color)) {
      const bitmap = image.toBitmap();
      const red = parseInt(color.slice(1, 3), 16),
        green = parseInt(color.slice(3, 5), 16),
        blue = parseInt(color.slice(5, 7), 16);
      for (let index = 0; index < bitmap.length; index += 4) {
        bitmap[index] = blue;
        bitmap[index + 1] = green;
        bitmap[index + 2] = red;
      }
      image = Electron.nativeImage.createFromBitmap(bitmap, { width: 22, height: 22 });
    }
    image.setTemplateImage(known === "template" && !color.startsWith("#"));
    return image;
  };
  const tray = new Electron.Tray(icon());
  tray.setToolTip("Headful — your Salesforce orgs");
  async function refresh() {
    let orgs: TrayOrg[] = [];
    let defaultId: string | null = null;
    let runtimeReady = false;
    let mcpEnabled = false;
    let clientCount = 0;
    let installedMods: HeadfulModDescriptor[] = [];
    let features: { id: string; enabled: boolean }[] = [];
    try {
      const result = headfulResultSchemas.status.parse(await rpc("status"));
      orgs = result.orgs;
      defaultId = result.defaultOrgId;
      runtimeReady = true;
      features = result.features;
      mcpEnabled = result.features.some((feature) => feature.id === "local-mcp" && feature.enabled);
      installedMods = headfulModsSchema.parse(await rpc("mods.list")).mods;
      const value = await rpc("grants.list");
      if (value && typeof value === "object" && "grants" in value && Array.isArray(value.grants))
        clientCount = value.grants.filter((grant) => grant && grant.revokedAt === null).length;
    } catch {
      /* Menu remains useful while starting or after a recoverable runtime error. */
    }
    const contributions = resolveHeadfulContributions(installedMods, features);
    const environmentLabel = (org: TrayOrg) =>
      org.isSandbox === null ? "Environment unverified" : org.isSandbox ? "Sandbox" : "Production";
    const active = orgs.find((org) => org.id === defaultId);
    tray.setImage(icon(active?.color));
    tray.setToolTip(
      active
        ? `Headful — ${active.label} (${environmentLabel(active)})`
        : "Headful — connect a Salesforce org",
    );
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: "Headful", enabled: false },
      {
        label: active
          ? `${active.label} · ${environmentLabel(active)} · ${active.status}`
          : runtimeReady
            ? "No default org selected"
            : "Local runtime starting…",
        enabled: false,
      },
      { type: "separator" },
      ...orgs.map((org) => ({
        label: `${org.label} · ${environmentLabel(org)} · ${org.status}`,
        type: "radio" as const,
        checked: org.id === defaultId,
        icon: icon(org.color),
        click: () => {
          void rpc("orgs.default", { orgId: org.id }).then(refresh).catch(report);
        },
      })),
      ...(active
        ? [
            {
              label: "Open default org in Salesforce",
              click: () => {
                void rpc("orgs.open", { orgId: active.id }).catch(report);
              },
            },
            {
              label:
                active.agentEnabled === false
                  ? "Enable agents for default org"
                  : "Disable agents for default org",
              click: () => {
                void rpc("orgs.update", {
                  orgId: active.id,
                  agentEnabled: active.agentEnabled === false,
                })
                  .then(refresh)
                  .catch(report);
              },
            },
            {
              label: active.remoteEnabled
                ? "Disable remote access for default org"
                : "Allow remote grants for default org",
              click: () => {
                void rpc("orgs.update", { orgId: active.id, remoteEnabled: !active.remoteEnabled })
                  .then(refresh)
                  .catch(report);
              },
            },
            {
              label: "Refresh default org health",
              click: () => {
                void rpc("orgs.health", { orgId: active.id }).then(refresh).catch(report);
              },
            },
          ]
        : []),
      { type: "separator" },
      {
        label: "Connect or import an org…",
        click: () => {
          void open("orgs");
        },
      },
      {
        label: "Open Headful workspace",
        accelerator: "Command+Shift+H",
        click: () => {
          void open("workspace");
        },
      },
      {
        label: `Local MCP ${mcpEnabled ? "enabled" : "disabled"} · ${clientCount} authorized ${clientCount === 1 ? "client" : "clients"}`,
        enabled: false,
      },
      {
        label: "Agent access & local MCP…",
        click: () => {
          void open("mods?modId=headful.mcp-apps");
        },
      },
      {
        label: "Settings…",
        accelerator: "Command+,",
        click: () => {
          void open("settings");
        },
      },
      { type: "separator" },
      ...installedMods.flatMap((mod) =>
        mod.runtimeStatuses.map((status) => ({
          label: `${mod.manifest.name} · ${status.label}${status.clientCount === undefined ? "" : ` · ${status.clientCount} clients`}${status.targetOrgIds.length ? ` · ${status.targetOrgIds.map((id) => orgs.find((org) => org.id === id)?.label ?? "Unavailable org").join(", ")}` : ""}`,
          enabled: false,
        })),
      ),
      ...contributions.menuBar
        .filter((item) => item.available)
        .map((item): Electron.MenuItemConstructorOptions => ({
          label: item.contribution.name,
          click: () => {
            const mod = installedMods.find((value) => value.manifest.id === item.modId);
            const command = mod?.manifest.contributions.commands.find(
              (value) => value.id === item.contribution.commandId,
            );
            if (command && command.parameters.length === 0)
              void rpc("mods.command", {
                id: item.modId,
                command: command.id,
                input: {},
              })
                .then(refresh)
                .catch(report);
            else void open(`mods?modId=${encodeURIComponent(item.modId)}`).catch(report);
          },
        })),
      {
        label: "Mods…",
        click: () => {
          void open("mods").catch(report);
        },
      },
      { label: "Revoke control connections", click: () => control.revoke() },
      { label: "Quit Headful", accelerator: "Command+Q", click: () => Electron.app.quit() },
    ];
    tray.setContextMenu(Electron.Menu.buildFromTemplate(items));
  }
  tray.on("click", () => {
    void refresh()
      .then(() => tray.popUpContextMenu())
      .catch(report);
  });
  const onThemeUpdated = () => {
    void refresh();
  };
  Electron.nativeTheme.on("updated", onThemeUpdated);
  yield* Effect.promise(refresh);
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      tray.destroy();
      deliverLink = undefined;
      Electron.app.removeListener("open-url", onOpenUrl);
      Electron.app.removeListener("second-instance", onSecondInstance);
      Electron.nativeTheme.removeListener("updated", onThemeUpdated);
      Electron.ipcMain.removeHandler("headful:routeReady");
      Electron.ipcMain.removeHandler("headful:dispatch");
      Electron.ipcMain.removeAllListeners("headful:open");
    }),
  );
});
