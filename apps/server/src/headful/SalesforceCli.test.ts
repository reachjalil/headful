import { afterEach, describe, expect, it } from "vite-plus/test";
// @effect-diagnostics-next-line nodeBuiltinImport:off - isolated temporary fixture files, never live Salesforce or Headful data.
import { chmodSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off - isolated temporary fixture files, never live Salesforce or Headful data.
import { join } from "node:path";
import { CliAdapter, salesforceOrigin } from "./SalesforceCli.ts";
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
function executable(behavior: string) {
  const folder = mkdtempSync(join(tmpdir(), "headful-cli-fixture-"));
  folders.push(folder);
  const path = join(folder, "sf");
  writeFileSync(path, `#!/usr/bin/env node\n${behavior}\n`);
  chmodSync(path, 0o700);
  return path;
}
describe("Salesforce CLI native adapter", () => {
  it("detects an explicitly configured sf path and strips raw credential fields from discovered connections", async () => {
    const path = executable(
      `const args=process.argv.slice(2);if(args[0]==='version')console.log(JSON.stringify({cliVersion:'@salesforce/cli/2.108.4 darwin-arm64 node-v24'}));else console.log(JSON.stringify({status:0,result:{nonScratchOrgs:[{orgId:'00D000000000001',username:'fictional@example.com',alias:'sandbox',isSandbox:true,accessToken:'never-render-this-token',refreshToken:'never-persist-this-token'}],scratchOrgs:[]}}));`,
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
      `const args=process.argv.slice(2);if(args[0]==='version')console.log(JSON.stringify({cliVersion:'@salesforce/cli/2.108.4'}));else {console.error('https://secret.invalid/auth?token=private');console.log(JSON.stringify({status:1,message:'access_token private'}));process.exitCode=1;}`,
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
