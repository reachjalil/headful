// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalFetch:off preferSchemaOverJson:off
import { app, BrowserWindow, MessageChannelMain, session, protocol } from "electron";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import { serializable } from "../../../../packages/mod-sdk/src/schema.ts";
type ExecutionJob = {
  context: string;
  revision: string;
  id: string;
  modId: string;
  directory: string;
  entry: string;
  method: string;
  input: unknown;
};
protocol.registerSchemesAsPrivileged([
  {
    scheme: "headful-mod",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: false,
      allowServiceWorkers: false,
    },
  },
]);
type Sandbox = {
  window: BrowserWindow;
  port: Electron.MessagePortMain;
  pending: Map<string, ReturnType<typeof setTimeout>>;
  context: string;
  brokerInflight: number;
  rateStart: number;
  rateCount: number;
};
const bootstrap = `(function(){let listener;let serial=0;const pending=new Map();window.addEventListener('message',event=>{if(event.data!=='headful-mod:port'||event.ports.length!==1)return;const port=event.ports[0];const channel={call(method,input){return new Promise((resolve,reject)=>{if(pending.size>=32)return reject(new Error('Queue full'));const id=String(++serial);pending.set(id,{resolve,reject});port.postMessage({kind:'call',id,method,input});});},listen(handler){listener=handler;return()=>{listener=null;};}};port.onmessage=async event=>{const m=event.data;if(m.kind==='response'){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Object.assign(new Error(m.error.message),{code:m.error.code})):p.resolve(m.result);return;}if(m.kind==='stop'){if(listener)await listener('lifecycle:dispose',{}).catch(()=>{});return;}if(m.kind==='invoke'){try{const result=await listener(m.method,m.input);port.postMessage({kind:'result',id:m.id,result});}catch(error){port.postMessage({kind:'result',id:m.id,error:String(error.message||'Mod failed').slice(0,300)});}}};port.start();try{globalThis.activateHeadfulMod(channel);}catch(error){port.postMessage({kind:'failed',error:String(error.message||'Activation failed').slice(0,300)});}}, {once:true});})();`;
/** Chromium sandbox with a port-only isolated preload; no Node or Electron objects reach mod code. Every message uses a main-owned port. */
export class ModSandboxHost {
  private sandboxes = new Map<string, Sandbox>();
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private preloadPath: string;
  private rpc: (operation: string, input?: unknown) => Promise<unknown>;
  constructor(rpc: (operation: string, input?: unknown) => Promise<unknown>, preloadPath: string) {
    this.rpc = rpc;
    this.preloadPath = preloadPath;
  }
  start() {
    void this.pump();
  }
  private async create(job: ExecutionJob): Promise<Sandbox> {
    if (this.sandboxes.size >= 16) throw new Error("Community execution limit reached.");
    const origin = `headful-mod://${job.context}/`,
      partition = `headful-mod-${NodeCrypto.randomUUID()}`,
      ses = session.fromPartition(partition, { cache: false }),
      root = await NodeFSP.realpath(job.directory),
      nonce = NodeCrypto.randomUUID();
    const csp = `default-src 'none'; script-src 'nonce-${nonce}' ${origin}; style-src 'unsafe-inline'; img-src data: ${origin}; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';`;
    ses.setPermissionRequestHandler((_w, _p, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: !details.url.startsWith(origin) }),
    );
    ses.protocol.handle("headful-mod", async (request) => {
      const url = new URL(request.url);
      if (url.protocol !== "headful-mod:" || url.host !== job.context)
        return new Response(null, { status: 403 });
      if (url.pathname === "/host.html")
        return new Response(
          `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body><script src="${origin}${job.entry.replace(/^\.\//, "")}"></script><script nonce="${nonce}">${bootstrap}</script></body></html>`,
          { headers: { "Content-Type": "text/html", "Content-Security-Policy": csp } },
        );
      const relative = decodeURIComponent(url.pathname).slice(1);
      const manifest = JSON.parse(
        await NodeFSP.readFile(NodePath.resolve(root, "headful.mod.json"), "utf8"),
      );
      const allowed = [
        job.entry.replace(/^\.\//, ""),
        ...manifest.resources
          .filter((r: { exposed: boolean }) => r.exposed)
          .map((r: { path: string }) => r.path.replace(/^\.\//, "")),
      ];
      if (!allowed.includes(relative)) return new Response(null, { status: 403 });
      const path = await NodeFSP.realpath(NodePath.resolve(root, relative));
      if (!path.startsWith(root + NodePath.sep) || !(await NodeFSP.lstat(path)).isFile())
        return new Response(null, { status: 403 });
      const mime = path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".svg")
            ? "image/svg+xml"
            : path.endsWith(".png")
              ? "image/png"
              : "application/octet-stream";
      return new Response(await NodeFSP.readFile(path), {
        headers: {
          "Content-Type": mime,
          "Content-Security-Policy": csp,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    });
    const window = new BrowserWindow({
      show: false,
      width: 520,
      height: 360,
      webPreferences: {
        session: ses,
        preload: this.preloadPath,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        devTools: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("will-redirect", (event) => event.preventDefault());
    window.webContents.on("will-attach-webview", (event) => event.preventDefault());
    const { port1, port2 } = new MessageChannelMain(),
      sandbox: Sandbox = {
        window,
        port: port1,
        pending: new Map(),
        context: job.context,
        brokerInflight: 0,
        rateStart: Date.now(),
        rateCount: 0,
      };
    this.sandboxes.set(job.context, sandbox);
    port1.on("message", async (event) => {
      if (this.sandboxes.get(job.context) !== sandbox || window.isDestroyed()) return;
      try {
        if (Date.now() - sandbox.rateStart > 1000) {
          sandbox.rateStart = Date.now();
          sandbox.rateCount = 0;
        }
        if (++sandbox.rateCount > 128) {
          this.destroy(job.context, true);
          return;
        }
        const message = serializable(event.data) as Record<string, unknown>;
        if (
          message.kind === "result" &&
          typeof message.id === "string" &&
          sandbox.pending.has(message.id)
        ) {
          clearTimeout(sandbox.pending.get(message.id));
          sandbox.pending.delete(message.id);
          await this.rpc("mods.execution.reply", {
            context: job.context,
            id: message.id,
            result: message.result ?? null,
            ...(typeof message.error === "string" ? { error: message.error.slice(0, 300) } : {}),
          });
          return;
        }
        if (
          message.kind === "call" &&
          typeof message.id === "string" &&
          /^[0-9]{1,8}$/.test(message.id) &&
          typeof message.method === "string" &&
          message.method.length < 180
        ) {
          if (sandbox.brokerInflight >= 32) {
            this.destroy(job.context, true);
            return;
          }
          sandbox.brokerInflight++;
          let result;
          try {
            result = await this.rpc("mods.broker", {
              context: job.context,
              method: message.method,
              input: message.input,
            });
          } finally {
            sandbox.brokerInflight--;
          }
          if (this.sandboxes.get(job.context) === sandbox)
            port1.postMessage({ kind: "response", id: message.id, result: serializable(result) });
          return;
        }
        if (message.kind === "failed") this.destroy(job.context, true);
      } catch (error) {
        if (!window.isDestroyed())
          port1.postMessage({
            kind: "response",
            id: event.data?.id,
            error: {
              code:
                typeof error === "object" && error && "code" in error
                  ? String(error.code)
                  : "operation_failed",
              message:
                error instanceof Error
                  ? error.message.slice(0, 300)
                  : "Mod operation denied or failed.",
            },
          });
      }
    });
    port1.start();
    const loading = setTimeout(() => this.destroy(job.context, true), 10000);
    try {
      await window.loadURL(origin + "host.html");
    } finally {
      clearTimeout(loading);
    }
    window.webContents.postMessage("headful-mod:port", "headful-mod:port", [port2]);
    return sandbox;
  }
  private destroy(context: string, failed = false) {
    const s = this.sandboxes.get(context);
    if (!s) return;
    this.sandboxes.delete(context);
    for (const t of s.pending.values()) clearTimeout(t);
    s.port.postMessage({ kind: "stop" });
    setTimeout(() => {
      s.port.close();
      if (!s.window.isDestroyed()) s.window.destroy();
    }, 50);
    if (failed) void this.rpc("mods.execution.fail", { context }).catch(() => undefined);
  }
  private async pump() {
    if (this.stopped) return;
    try {
      const metrics = app.getAppMetrics();
      for (const [context, s] of this.sandboxes) {
        const memory = metrics.find((m) => m.pid === s.window.webContents.getOSProcessId())?.memory;
        if (memory && memory.workingSetSize > 256 * 1024) this.destroy(context, true);
      }
      const result = (await this.rpc("mods.execution.pull")) as {
        contexts: string[];
        jobs: ExecutionJob[];
      };
      for (const id of this.sandboxes.keys()) if (!result.contexts.includes(id)) this.destroy(id);
      for (const job of result.jobs) {
        try {
          const s = this.sandboxes.get(job.context) ?? (await this.create(job));
          const timer = setTimeout(() => this.destroy(job.context, true), 10500);
          s.pending.set(job.id, timer);
          s.port.postMessage({
            kind: "invoke",
            id: job.id,
            method: job.method,
            input: serializable(job.input),
          });
        } catch {
          await this.rpc("mods.execution.reply", {
            context: job.context,
            id: job.id,
            error: "Community execution could not start.",
          });
        }
      }
    } catch {
      /* Runtime may be starting. No provider operations or code downloads are retried. */
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.pump(), 250);
  }
  close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    for (const id of this.sandboxes.keys()) this.destroy(id);
  }
}
