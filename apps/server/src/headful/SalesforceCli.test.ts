import { afterEach, describe, expect, it } from "vite-plus/test";
// @effect-diagnostics-next-line nodeBuiltinImport:off - isolated temporary fixture files, never live Salesforce or Headful data.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off - isolated temporary fixture files, never live Salesforce or Headful data.
import * as NodePath from "node:path";
import { CliAdapter, salesforceOrigin } from "./SalesforceCli.ts";
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) NodeFS.rmSync(folder, { recursive: true, force: true });
});
function executable(behavior: string) {
  const folder = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "headful-cli-fixture-"));
  folders.push(folder);
  const path = NodePath.join(folder, "sf");
  NodeFS.writeFileSync(path, `#!/usr/bin/env node\n${behavior}\n`);
  NodeFS.chmodSync(path, 0o700);
  return path;
}
describe("Salesforce CLI native adapter", () => {
  it("pins metadata discovery to the application API version and preserves exact folder casing", async () => {
    const path = executable(`
const args=process.argv.slice(2);
if(args[0]==='version') console.log(JSON.stringify({cliVersion:'@salesforce/cli/2.136.0'}));
else if(args[args.indexOf('--api-version')+1]==='67.0' && args[args.indexOf('--target-org')+1]==='fictional@example.com' && (args[2]==='metadata-types' || args[args.indexOf('--folder')+1]==='SalesFolder')) console.log(JSON.stringify({status:0,result:[]}));
else {console.log(JSON.stringify({status:1}));process.exitCode=1;}
`);
    const cli = new CliAdapter(path);
    try {
      expect(await cli.metadataTypes("fictional@example.com")).toEqual([]);
      expect(
        await cli.metadataComponents("fictional@example.com", "Report", "SalesFolder"),
      ).toEqual([]);
    } finally {
      cli.close();
    }
  });
  it("retrieves only the explicit access token, pins it to the resolved username and ignores redacted display credentials", async () => {
    const path = executable(`
const args = process.argv.slice(2);
if(args[0] === 'version') console.log(JSON.stringify({cliVersion:'@salesforce/cli/2.136.0'}));
else if(args[1] === 'display') console.log(JSON.stringify({status:0,result:{id:'00D000000000001',username:'fictional@example.com',instanceUrl:'https://fictional.my.salesforce.com',accessToken:"[REDACTED] Use 'sf org auth show-access-token' to view",sfdxAuthUrl:'never-read-refresh-token'}}));
else if(args.slice(0,3).join(' ') === 'org auth show-access-token' && args[args.indexOf('--target-org')+1] === 'fictional@example.com' && args.includes('--json')) console.log(JSON.stringify({status:0,result:{accessToken:'fixture-explicit-token'}}));
else { console.log(JSON.stringify({status:1})); process.exitCode=1; }
`);
    const cli = new CliAdapter(path);
    try {
      expect(await cli.session("mutable-alias")).toMatchObject({
        username: "fictional@example.com",
        accessToken: "fixture-explicit-token",
        userId: null,
      });
    } finally {
      cli.close();
    }
  });

  it("rejects a redacted token from the credential command before it reaches fetch", async () => {
    const path = executable(`
const args = process.argv.slice(2);
if(args[0] === 'version') console.log(JSON.stringify({cliVersion:'@salesforce/cli/2.136.0'}));
else if(args[1] === 'display') console.log(JSON.stringify({status:0,result:{id:'00D000000000001',username:'fictional@example.com',instanceUrl:'https://fictional.my.salesforce.com'}}));
else console.log(JSON.stringify({status:0,result:{accessToken:'[REDACTED]'}}));
`);
    const cli = new CliAdapter(path);
    try {
      await expect(cli.session("fictional@example.com")).rejects.toThrow("usable access token");
    } finally {
      cli.close();
    }
  });
  it("detects an explicitly configured sf path and strips raw credential fields from discovered connections", async () => {
    const path = executable(
      `const args=process.argv.slice(2);if(args[0]==='version')console.log(JSON.stringify({cliVersion:'@salesforce/cli/2.136.0 darwin-arm64 node-v24'}));else console.log(JSON.stringify({status:0,result:{nonScratchOrgs:[{orgId:'00D000000000001',username:'fictional@example.com',alias:'sandbox',isSandbox:true,accessToken:'never-render-this-token',refreshToken:'never-persist-this-token'}],scratchOrgs:[]}}));`,
    );
    const cli = new CliAdapter(path);
    try {
      expect(await cli.detect()).toMatchObject({
        selected: path,
        state: expect.stringMatching(/ready|multiple/),
      });
      const result = await cli.discover();
      expect(result).toMatchObject({
        connections: [{ username: "fictional@example.com", environment: "sandbox" }],
      });
      expect(JSON.stringify(result)).not.toContain("token");
    } finally {
      cli.close();
    }
  });
  it("normalizes CLI rejection without returning raw errors or auth URLs and restricts Salesforce origins", async () => {
    const path = executable(
      `const args=process.argv.slice(2);if(args[0]==='version')console.log(JSON.stringify({cliVersion:'@salesforce/cli/2.136.0'}));else {console.error('https://secret.invalid/auth?token=private');console.log(JSON.stringify({status:1,message:'access_token private'}));process.exitCode=1;}`,
    );
    const cli = new CliAdapter(path);
    try {
      await cli.detect();
      await expect(cli.discover()).rejects.toMatchObject({ code: "cli_rejected" });
      try {
        await cli.discover();
      } catch (error) {
        expect(String(error)).not.toContain("private");
        expect(String(error)).not.toContain("secret.invalid");
      }
      expect(() => salesforceOrigin("https://evil.invalid")).toThrow();
      expect(() => salesforceOrigin("http://localhost:1234")).toThrow();
      expect(salesforceOrigin("https://fictional.my.salesforce.com/path")).toBe(
        "https://fictional.my.salesforce.com",
      );
    } finally {
      cli.close();
    }
  });
});

it("fails closed for an obsolete SFDX executable or invalid configured path instead of choosing another installation", async () => {
  const path = executable(
    `console.log(JSON.stringify({cliVersion:'sfdx-cli/7.209.6 darwin-arm64 node-v18'}));`,
  );
  const cli = new CliAdapter(path);
  try {
    const result = await cli.detect();
    expect(result.selected).toBeNull();
    expect(result.installations.find((item) => item.path === path)).toMatchObject({
      supported: false,
    });
    const invalid = await cli.configure("/tmp/headful-definitely-missing-cli-executable");
    expect(invalid.selected).toBeNull();
  } finally {
    cli.close();
  }
});

it("enforces this release's minimum before any org command even when another CLI is installed", async () => {
  const path = executable(
    "console.log(JSON.stringify({cliVersion:'@salesforce/cli/2.135.99 darwin-arm64'}));",
  );
  const cli = new CliAdapter(path);
  try {
    expect(await cli.detect()).toMatchObject({
      selected: null,
      state: "unsupported",
      minimumVersion: "2.136.0",
    });
    await expect(cli.discover()).rejects.toMatchObject({ code: "cli_missing" });
  } finally {
    cli.close();
  }
});
