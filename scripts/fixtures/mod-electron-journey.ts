// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
// A synthetic provider-free journey through the actual Electron sandbox and artifact loader.
import { app, webContents } from "electron";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { ModSandboxHost } from "../../apps/desktop/src/headful/ModSandbox.ts";
import { CommunityExecution } from "../../apps/server/src/headful/mods/CommunityExecution.ts";
import { ModRepository } from "../../apps/server/src/headful/InstalledMods.ts";
import {
  makeHeadfulRuntime,
  type HeadfulRuntime,
} from "../../apps/server/src/headful/WorkspaceService.ts";
import { createModBroker } from "../../apps/server/src/headful/mods/ModBroker.ts";
import { hash } from "../../apps/server/src/headful/mods/ModArtifact.ts";
void (async () => {
  let runtime: HeadfulRuntime | undefined,
    sandbox: ModSandboxHost | undefined,
    folder = "",
    failed = false;
  const checks: string[] = [];
  const assert = (condition: unknown, description: string) => {
    if (!condition) throw new Error(description);
    checks.push(description);
    console.log("PASS " + description);
  };
  try {
    await app.whenReady();
    folder = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "headful-electron-mod-"));
    const execution = new CommunityExecution(
        createModBroker(
          () => runtime!.store,
          () => runtime!.mods,
        ),
      ),
      repo = new ModRepository(folder, execution);
    await repo.load();
    const artifact = NodePath.join(folder, "hello.headfulmod");
    await NodeFSP.copyFile(process.env.HEADFUL_TEST_MOD!, artifact);
    let definitions = await repo.install(artifact);
    const probe = JSON.parse(await NodeFSP.readFile(artifact, "utf8"));
    probe.manifest.id = "org.example.probe";
    probe.manifest.name = "Isolation probe";
    probe.manifest.apis = [];
    probe.manifest.eventSubscriptions = [];
    probe.manifest.contributions.events = [];
    probe.manifest.permissions = [];
    probe.manifest.contributions.commands = [
      {
        id: "org.example.probe/probe",
        name: "Probe",
        description: "Synthetic isolation check.",
        parameters: [],
      },
    ];
    probe.manifest.contributions.surfaces = [];
    probe.manifest.contributions.navigation = [];
    probe.manifest.contributions.actions = [];
    const source = `globalThis.activateHeadfulMod=channel=>channel.listen(async()=>{let network=false,file=false,broker=false;try{await fetch('https://example.com/');network=true;}catch{}try{await fetch('file:///etc/passwd');file=true;}catch{}try{await channel.call('host',{modId:'headful.mcp-apps',capability:'salesforce:read',operation:'listUsers',input:{orgId:'forged'}});broker=true;}catch{}const popup=window.open('https://example.com/')!==null;location.assign('https://example.com/');return {message:'Isolation probe',values:{node:typeof require!=='undefined',process:typeof process!=='undefined',electron:typeof ipcRenderer!=='undefined',credentials:typeof headfulBridge!=='undefined',network,file,broker,popup}};});`;
    probe.files[0] = {
      path: "dist/index.js",
      data: Buffer.from(source).toString("base64"),
      size: Buffer.byteLength(source),
      sha256: hash(source),
    };
    const probeFile = NodePath.join(folder, "probe.headfulmod");
    await NodeFSP.writeFile(probeFile, JSON.stringify(probe));
    definitions = await repo.install(probeFile);
    runtime = makeHeadfulRuntime({ homeDir: folder, mods: definitions });
    const rpc = async (operation: string, input: any = {}) => {
      if (operation === "mods.execution.pull") return execution.pull();
      if (operation === "mods.execution.reply")
        return execution.reply(input.context, input.id, input.result ?? null, input.error);
      if (operation === "mods.broker")
        return execution.call(input.context, input.method, input.input);
      throw new Error("Unsupported test host operation.");
    };
    sandbox = new ModSandboxHost(rpc, process.env.HEADFUL_TEST_PRELOAD!);
    sandbox.start();
    const id = "org.example.hello",
      revision = runtime.mods.inspect(id).artifactRevision;
    await runtime.mods.grant(id, revision, ["local:storage", "host:events"]);
    await runtime.mods.enable(id);
    assert(
      runtime.mods.inspect(id).status === "inactive",
      "lazy activation after permission review and enable",
    );
    let staleRejected = false;
    try {
      await runtime.mods.command(id, id + "/hello", {}, "replaced-revision");
    } catch (error) {
      staleRejected =
        error instanceof Error && "code" in error && error.code === "mod_revision_changed";
    }
    assert(
      staleRejected && runtime.mods.inspect(id).status === "inactive",
      "stale editor revision rejected before sandbox activation",
    );
    const command = await runtime.mods.command(id, id + "/hello", {}, revision);
    assert(command.values?.count === 1, "reference SDK command through actual community sandbox");
    assert(
      (await runtime.mods.api(id, id + "/greet", { name: "Contributor" })) === "Hello, Contributor",
      "schema-checked contributed API",
    );
    const view = await runtime.mods.surface(id, "overview", revision);
    assert(view.markdown.includes("Invocations: 1"), "contributed view through sandbox");
    await runtime.mods.publishEvent({ type: "default-org-changed", orgId: null });
    assert(
      runtime.store.preference<any>("mod:" + id + ":storage", {}).events === 1,
      "declared event delivered once through host-owned routing",
    );
    const probeId = "org.example.probe";
    await runtime.mods.enable(probeId);
    const result = await runtime.mods.command(probeId, probeId + "/probe", {});
    assert(
      Object.values(result.values!).every((value) => value === false),
      "Node, process, Electron, credentials, network, file access, popups and forged authority denied",
    );
    const documents = webContents
      .getAllWebContents()
      .filter((contents) => contents.getType() === "window");
    assert(
      documents.length === 2 &&
        documents.every((contents) => contents.getURL().startsWith("headful-mod://")),
      "external navigation is blocked and both sandbox documents remain on their host-owned origins",
    );
    await runtime.mods.disable(id);
    assert(
      execution.pull().contexts.length === 1,
      "disable terminates the reference execution context",
    );
    await repo.uninstall(id);
    assert(
      runtime.store.preference<any>("mod:" + id + ":storage", {}).count === 1,
      "uninstall preserves scoped user state",
    );
    await runtime.mods.disable(probeId);
    assert(execution.pull().contexts.length === 0, "all execution contexts removed after disable");
    console.log(
      JSON.stringify(
        {
          passed: true,
          checks,
          electron: process.versions.electron,
          chromium: process.versions.chrome,
          node: process.versions.node,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error);
    failed = true;
  } finally {
    sandbox?.close();
    await runtime?.close();
    if (folder) await NodeFSP.rm(folder, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  }
})();
