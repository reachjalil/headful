// @effect-diagnostics nodeBuiltinImport:off
// Native test fixtures own only isolated temporary files and exact fake CLI children.
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { CliAdapter } from "./SalesforceCli.ts";
import { LocalStore } from "./Store.ts";
import { makeHeadfulRuntime, type HeadfulRuntime } from "./WorkspaceService.ts";
import type { HeadfulModDefinition } from "../../../../packages/contracts/src/headful-mods.ts";
import { boundedSoql } from "./utilities/soql.ts";
const desktop = { kind: "desktop" as const },
  orgId = "fictional_utility_org",
  secondOrgId = "fictional_second_org",
  sfOrgId = "00D000000000001",
  userId = "005000000000001";
const cleanup: Array<{ runtime: HeadfulRuntime; folder: string }> = [];
afterEach(async () => {
  for (const item of cleanup.splice(0)) {
    await item.runtime.close();
    NodeFS.rmSync(item.folder, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});
function mod(id: string, features: string[]): HeadfulModDefinition {
  return {
    nativeTrusted: true,
    hostPermissions: ["salesforce:read", "salesforce:org-navigation"],
    manifest: {
      schemaVersion: 1,
      execution: "native",
      apiVersion: 1,
      id,
      name: "Fixture utilities",
      description: "Test-only trusted mod.",
      version: "1.0.0",
      license: "MIT",
      source: "bundled",
      defaultEnabled: true,
      contributions: {
        features: features.map((feature) => ({
          id: feature,
          name: feature,
          description: "Fixture",
          defaultEnabled: true,
          dependencies: ["org-management"],
          route: "utilities",
        })),
      },
    },
    activate: async () => ({ dispose() {} }),
  };
}
function readyFile(folder: string, name: string) {
  const file = NodePath.join(folder, name);
  return new Promise<string>((resolve) => {
    const observer = NodeFS.watch(folder, () => {
      if (NodeFS.existsSync(file)) {
        const data = NodeFS.readFileSync(file, "utf8");
        if (data) {
          observer.close();
          resolve(data);
        }
      }
    });
    if (NodeFS.existsSync(file)) {
      observer.close();
      resolve(NodeFS.readFileSync(file, "utf8"));
    }
  });
}
function setup() {
  const folder = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "headful-utilities-")),
    executable = NodePath.join(folder, "sf"),
    trace = NodePath.join(folder, "trace.jsonl");
  const fixture = `
const fs=require('node:fs');const path=require('node:path');const folder=${JSON.stringify(folder)};const args=process.argv.slice(2);const emit=r=>console.log(JSON.stringify({status:0,result:r}));const flag=n=>args[args.indexOf(n)+1];
if(args[0]==='version'){console.log(JSON.stringify({cliVersion:'@salesforce/cli/2.136.0'}));return;}
fs.appendFileSync(path.join(folder,'trace.jsonl'),JSON.stringify(args)+'\\n');
if(args[0]==='org'&&args[1]==='display'){emit({id:'${sfOrgId}',username:'fictional@example.com',instanceUrl:'https://fictional.my.salesforce.com',accessToken:'fixture-private-access-token'});return;}
if(args[0]==='org'&&args[1]==='auth'&&args[2]==='show-access-token'){emit({accessToken:'fixture-private-access-token'});return;}
if(args[0]==='api'){console.log(JSON.stringify({user_id:fs.existsSync(path.join(folder,'identity-changed'))?'005000000000009':'${userId}',organization_id:'${sfOrgId}',preferred_username:'fictional@example.com',access_token:'must-never-cross-the-boundary'}));return;}
if(args[0]==='data'&&args[1]==='query'){
 const q=flag('--query');if(q.includes('REJECT_MARKER')){console.log(JSON.stringify({status:1,name:'MALFORMED_QUERY',message:'access_token private-error-secret'}));process.exitCode=1;return;}if(q.includes('WAIT_MARKER')){process.on('SIGTERM',()=>{fs.writeFileSync(path.join(folder,'stopped'),String(process.pid));process.exit(0)});fs.writeFileSync(path.join(folder,'started'),JSON.stringify({pid:process.pid,args}));setInterval(()=>{},10000);return;}
 if(q.includes('TOO_LARGE')){console.log(JSON.stringify({status:0,result:{records:[{Name:'x'.repeat(5*1024*1024)}]}}));return;}
 const limit=Number(q.match(/LIMIT (\\d+)(?: OFFSET \\d+)?$/)?.[1]??3);emit({totalSize:limit,done:true,accessToken:'raw-envelope-secret',records:[{Id:'001000000000001',Name:'One',Account:{Name:'Related'},attributes:{url:'never-render'}},{Id:'001000000000002',Name:'fixture-private-access-token'},{Id:'001000000000003',Name:'Three'}].slice(0,limit)});return;
}
if(args[0]==='sobject'&&args[1]==='list'){emit(['Account','Example__c']);return;}
if(args[0]==='sobject'&&args[1]==='describe'){emit({name:fs.existsSync(path.join(folder,'describe-changed'))?'Contact':'Account',label:'Account',queryable:true,fields:[{name:'Id',label:'Record ID',type:'id'},{name:'Name',label:'Account name',type:'string',length:255},{name:'Revenue_Band__c',label:'Revenue band',type:'string',calculated:true,calculatedFormula:fs.existsSync(path.join(folder,'describe-long-formula'))?'x'.repeat(20001):'IF(AnnualRevenue >= 1000000, "Enterprise", "Growth")'},{name:'Rollup__c',label:'Rollup',type:'double',calculated:true}],childRelationships:[]});return;}
if(args[0]==='data'&&args[1]==='get'){emit({Id:flag('--record-id'),Name:'Readable outside layout',attributes:{accessToken:'never-render'}});return;}
if(args[0]==='org'&&args[1]==='list'){emit([{name:'DataStorageMB',max:1000,remaining:500}]);return;}
if(args[0]==='apex'&&args[1]==='list'){emit([{Id:'07L000000000001',LogLength:50,StartTime:'2026-10-04T00:00:00Z',Operation:'Apex',Status:'Success'}]);return;}
if(args[0]==='apex'&&args[1]==='get'){emit([{log:'Diagnostic fixture-private-access-token\\nAuthorization: Bearer private-other-secret\\nclient_secret=another-private-secret'}]);return;}
emit({});`;
  NodeFS.writeFileSync(executable, `#!${process.execPath}\n${fixture}`);
  NodeFS.chmodSync(executable, 0o700);
  const store = new LocalStore(folder);
  for (const [id, sfId, username] of [
    [orgId, sfOrgId, "fictional@example.com"],
    [secondOrgId, "00D000000000002", "second@example.com"],
  ])
    store.db
      .prepare(
        "INSERT INTO orgs(id,application_id,label,salesforce_org_id,salesforce_user_id,instance_origin,username,alias,color,agent_enabled,is_sandbox,organization_name,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,1,1,'Fictional','connected',1)",
      )
      .run(
        id!,
        id!,
        "Fictional",
        sfId!,
        userId,
        "https://fictional.my.salesforce.com",
        username!,
        "fixture",
        "#626dd2",
      );
  const cli = new CliAdapter(executable),
    runtime = makeHeadfulRuntime({
      homeDir: folder,
      store,
      cli,
      mods: [
        mod("headful.admin-utilities", [
          "headful.admin-utilities/org-shortcuts",
          "headful.admin-utilities/backup",
          "headful.admin-utilities/record-inspector",
          "headful.admin-utilities/soql",
          "headful.admin-utilities/schema",
          "headful.admin-utilities/diagnostics",
        ]),
        mod("headful.mcp-apps", ["local-mcp", "external-harness"]),
      ],
    });
  cleanup.push({ runtime, folder });
  return {
    runtime,
    folder,
    store,
    cli,
    trace: () =>
      NodeFS.existsSync(trace)
        ? NodeFS.readFileSync(trace, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as string[])
        : [],
  };
}
describe("CLI-backed Salesforce utilities", () => {
  it("opens only the canonical backup destination for the verified org without exposing native credentials", async () => {
    const c = setup();
    const result = await c.runtime.dispatch("utilities.backup.location", { orgId }, desktop);
    expect(result).toEqual({
      url: `https://headful.cloud/backup?sourceOrg=${sfOrgId}`,
      executor: "cloud",
      cloudAuthorization: "required",
    });
    expect(JSON.stringify(result)).not.toMatch(/accessToken|fictional@example|fixture-private/);
    NodeFS.writeFileSync(NodePath.join(c.folder, "identity-changed"), "yes");
    await expect(
      c.runtime.dispatch("utilities.backup.location", { orgId }, desktop),
    ).rejects.toThrow();
  });

  it("pins identity and argv, returns bounded pages, redacts CLI credentials and rejects execution clauses", async () => {
    const c = setup();
    const result = await c.runtime.dispatch(
      "utilities.query.run",
      {
        orgId,
        requestId: "query_request_1",
        query: "SELECT Id, Name, Account.Name FROM Account",
        pageSize: 2,
      },
      desktop,
    );
    expect(result).toMatchObject({
      returned: 2,
      hasMore: true,
      records: [{ Id: "001000000000001", "Account.Name": "Related" }, { Name: "[REDACTED]" }],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-access-token|raw-envelope-secret|never-render/,
    );
    const command = c.trace().find((args) => args[0] === "data" && args[1] === "query")!;
    expect(command).toEqual([
      "data",
      "query",
      "--query",
      "SELECT Id, Name, Account.Name FROM Account LIMIT 3",
      "--target-org",
      "fictional@example.com",
      "--json",
    ]);
    expect(c.trace().find((args) => args[0] === "api")).toEqual([
      "api",
      "request",
      "rest",
      "/services/oauth2/userinfo",
      "--method",
      "GET",
      "--target-org",
      "fictional@example.com",
    ]);
    const history = await c.runtime.dispatch("utilities.history.list", { orgId }, desktop);
    expect(history.history[0]).toMatchObject({ orgId, status: "success", returned: 2 });
    await expect(
      c.runtime.dispatch(
        "utilities.query.run",
        { orgId, requestId: "query_request_2", query: "SELECT Id FROM Account FOR UPDATE" },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "soql_read_only" });
    await expect(
      c.cli.utilityQuery("fictional@example.com", "delete Account"),
    ).rejects.toMatchObject({ code: "soql_read_only" });
    expect(boundedSoql("SELECT Id FROM Account WHERE Name='LIMIT 999' LIMIT 3", 2, 2)).toEqual({
      query: "SELECT Id FROM Account WHERE Name='LIMIT 999' LIMIT 1 OFFSET 2",
      limit: 1,
      canPage: false,
    });
    expect(() => boundedSoql("SELECT Id FROM Account", 6, 500)).toThrow(/2,000/);
    await expect(
      c.runtime.dispatch(
        "utilities.query.run",
        {
          orgId,
          requestId: "query_request_3",
          query: "SELECT Name FROM Account WHERE Name='TOO_LARGE'",
        },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "cli_output_bound" });
    await expect(
      c.runtime.dispatch(
        "utilities.query.run",
        {
          orgId,
          requestId: "query_request_4",
          query: "SELECT Name FROM Account WHERE Name='REJECT_MARKER'",
        },
        desktop,
      ),
    ).rejects.toMatchObject({
      code: "cli_query_invalid",
      message: "Salesforce rejected the SOQL syntax. Check the selected fields and query clauses.",
    });
  });
  it("enforces current client/org/capability access and rejects changed authenticated principals", async () => {
    const c = setup(),
      agent = {
        kind: "mcp" as const,
        clientId: "fictional-client",
        orgIds: [orgId],
        scopes: ["headful:read"],
      };
    await expect(
      c.runtime.dispatch(
        "utilities.query.run",
        { orgId, requestId: "query_request_1", query: "SELECT Id FROM Account" },
        agent,
      ),
    ).rejects.toMatchObject({ code: "scope" });
    await expect(
      c.runtime.dispatch(
        "utilities.objects.list",
        { orgId: secondOrgId },
        { ...agent, scopes: ["headful:read", "headful:schema"] },
      ),
    ).rejects.toMatchObject({ code: "org_missing" });
    expect(c.trace()).toHaveLength(0);
    NodeFS.writeFileSync(NodePath.join(c.folder, "identity-changed"), "changed");
    await expect(
      c.runtime.dispatch(
        "utilities.record.get",
        { orgId, object: "Account", recordId: "001000000000001" },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "identity_changed" });
    expect(c.trace().some((args) => args[0] === "data" && args[1] === "get")).toBe(false);
    await c.runtime.dispatch("mods.disable", { id: "headful.admin-utilities" }, desktop);
    await expect(
      c.runtime.dispatch("utilities.objects.list", { orgId }, desktop),
    ).rejects.toMatchObject({ code: "mod_disabled" });
    expect((await c.runtime.dispatch("status", {}, desktop)).accountRequired).toBe(false);
  });
  it("cancels its exact CLI child and keeps cancellation ownership pinned to client and org", async () => {
    const c = setup(),
      started = readyFile(c.folder, "started"),
      stopped = readyFile(c.folder, "stopped");
    const running = c.runtime
      .dispatch(
        "utilities.query.run",
        {
          orgId,
          requestId: "query_cancel_1",
          query: "SELECT Id FROM Account WHERE Name='WAIT_MARKER'",
        },
        desktop,
      )
      .catch((error: unknown) => error);
    const child = JSON.parse(await started) as { pid: number; args: string[] };
    expect(child.args).toContain("fictional@example.com");
    expect(
      await c.runtime.dispatch(
        "utilities.query.cancel",
        { orgId, requestId: "query_cancel_1" },
        {
          kind: "mcp",
          clientId: "other-client",
          orgIds: [orgId],
          scopes: ["headful:read", "headful:query"],
        },
      ),
    ).toEqual({ requestId: "query_cancel_1", cancelled: false });
    expect(
      await c.runtime.dispatch(
        "utilities.query.cancel",
        { orgId, requestId: "query_cancel_1" },
        desktop,
      ),
    ).toEqual({ requestId: "query_cancel_1", cancelled: true });
    expect(await running).toMatchObject({ code: "query_cancelled" });
    expect(await stopped).toBe(String(child.pid));
    expect(
      (await c.runtime.dispatch("utilities.history.list", { orgId }, desktop)).history[0]?.status,
    ).toBe("cancelled");
  });
  it("terminates an active query when its mod is disabled", async () => {
    const c = setup(),
      started = readyFile(c.folder, "started"),
      stopped = readyFile(c.folder, "stopped");
    const result = c.runtime
      .dispatch(
        "utilities.query.run",
        {
          orgId,
          requestId: "query_disable_1",
          query: "SELECT Id FROM Account WHERE Name='WAIT_MARKER'",
        },
        desktop,
      )
      .catch((error: unknown) => error);
    await started;
    await c.runtime.dispatch("mods.disable", { id: "headful.admin-utilities" }, desktop);
    expect(await result).toMatchObject({ code: "query_cancelled" });
    expect(await stopped).toMatch(/^\d+$/);
  });
  it("returns bounded formula source from the verified describe read and preserves unavailable source", async () => {
    const c = setup();
    const result = await c.runtime.dispatch(
      "utilities.objects.describe",
      { orgId, object: "Account" },
      desktop,
    );
    expect(result.fields[1]).toMatchObject({ calculated: false, calculatedFormula: null });
    expect(result.fields[2]).toMatchObject({
      calculated: true,
      calculatedFormula: 'IF(AnnualRevenue >= 1000000, "Enterprise", "Growth")',
    });
    expect(result.fields[3]).toMatchObject({ calculated: true, calculatedFormula: null });
    NodeFS.writeFileSync(NodePath.join(c.folder, "describe-long-formula"), "oversize");
    await expect(
      c.runtime.dispatch("utilities.objects.describe", { orgId, object: "Account" }, desktop),
    ).rejects.toThrow();
  });
  it("inspects schema and records, bounds diagnostics/logs, and preserves org-scoped saved work/header preferences", async () => {
    const c = setup();
    expect(
      (await c.runtime.dispatch("utilities.objects.list", { orgId }, desktop)).objects,
    ).toEqual([
      { name: "Account", custom: false },
      { name: "Example__c", custom: true },
    ]);
    expect(
      (
        await c.runtime.dispatch(
          "utilities.objects.describe",
          { orgId, object: "Account" },
          desktop,
        )
      ).fields[1],
    ).toMatchObject({ name: "Name", label: "Account name", type: "string", length: 255 });
    expect(
      (
        await c.runtime.dispatch(
          "utilities.record.get",
          { orgId, object: "Account", recordId: "001000000000001" },
          desktop,
        )
      ).fields[1]?.value,
    ).toBe("Readable outside layout");
    NodeFS.writeFileSync(NodePath.join(c.folder, "describe-changed"), "changed");
    await expect(
      c.runtime.dispatch(
        "utilities.record.get",
        { orgId, object: "Account", recordId: "001000000000001" },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "schema_identity" });
    const diagnostics = await c.runtime.dispatch("utilities.diagnostics", { orgId }, desktop);
    expect(diagnostics.storage).toEqual([
      { name: "DataStorageMB", max: 1000, remaining: 500, unit: "MB" },
    ]);
    expect(diagnostics.messages).toHaveLength(1);
    expect((await c.runtime.dispatch("utilities.logs.list", { orgId }, desktop)).logs[0]?.id).toBe(
      "07L000000000001",
    );
    const log = await c.runtime.dispatch(
      "utilities.logs.get",
      { orgId, logId: "07L000000000001" },
      desktop,
    );
    expect(log.body).not.toMatch(
      /private-access-token|private-other-secret|another-private-secret/,
    );
    const saved = await c.runtime.dispatch(
      "utilities.saved.set",
      { orgId, name: "Accounts", query: "SELECT Id FROM Account" },
      desktop,
    );
    await expect(
      c.runtime.dispatch(
        "utilities.saved.set",
        { orgId: secondOrgId, id: saved.id, name: "Wrong org", query: saved.query },
        desktop,
      ),
    ).rejects.toMatchObject({ code: "saved_query_missing" });
    const favorite = await c.runtime.dispatch(
      "utilities.favorites.set",
      { orgId, label: "Users", destination: "users" },
      desktop,
    );
    expect(
      (await c.runtime.dispatch("utilities.favorites.list", { orgId: secondOrgId }, desktop))
        .favorites,
    ).toEqual([]);
    expect(
      (await c.runtime.dispatch("utilities.favorites.list", { orgId }, desktop)).favorites[0]?.id,
    ).toBe(favorite.id);
    const preferences = {
      workspace: {
        global: {
          order: ["core/search", "headful.admin-utilities/saved-queries"],
          hidden: ["core/status"],
        },
        overrides: { "headful.admin-utilities/soql": { order: [], hidden: [] } },
      },
    };
    expect(await c.runtime.dispatch("preferences.set", preferences, desktop)).toEqual(preferences);
    expect(await c.runtime.dispatch("preferences.get", {}, desktop)).toEqual(preferences);
    expect(
      await c.runtime.dispatch("utilities.org.open", { orgId, destination: "users" }, desktop),
    ).toEqual({ opened: true });
    expect(c.trace().at(-1)).toEqual([
      "org",
      "open",
      "--path",
      "/lightning/setup/ManageUsers/home",
      "--target-org",
      "fictional@example.com",
      "--json",
    ]);
  });
});
