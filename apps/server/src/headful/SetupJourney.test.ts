// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalTimers:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { expect, it, vi } from "vite-plus/test";
import { CliAdapter } from "./SalesforceCli.ts";
import { makeHeadfulRuntime } from "./WorkspaceService.ts";
import { HEADFUL_MINIMUM_SALESFORCE_CLI_VERSION } from "@t3tools/contracts/headful";

it("runs CLI detection → discovery → verified enablement → reconnect → persisted setup through the native service", async () => {
  const homeDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "headful-setup-journey-"));
  const executable = NodePath.join(homeDir, "sf");
  NodeFS.writeFileSync(
    executable,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const result = args[0] === 'version' ? { cliVersion: '@salesforce/cli/${HEADFUL_MINIMUM_SALESFORCE_CLI_VERSION} darwin-arm64' } : { status: 0, result:
args[1] === 'list' ? { nonScratchOrgs: [{ orgId: '00D000000000001', username: 'alex@fictional.example', alias: 'Fictional Production', isSandbox: false, connectedStatus: 'Connected', accessToken: 'fixture-secret' }], scratchOrgs: [{ orgId: '00D000000000002', username: 'scratch@fictional.example', alias: 'Fictional Scratch', accessToken: 'fixture-secret' }] } :
args[1] === 'login' ? { username: 'other@fictional.example', accessToken: 'fixture-secret' } :
{ id: args.includes('scratch@fictional.example') ? '00D000000000002' : '00D000000000001', username: args[args.indexOf('--target-org') + 1], instanceUrl: 'https://fictional.my.salesforce.com', userId: args.includes('other@fictional.example') ? '005000000000002' : '005000000000001', accessToken: 'fixture-secret' } };
console.log(JSON.stringify(result));
`,
  );
  NodeFS.chmodSync(executable, 0o700);
  const cli = new CliAdapter(executable);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const query = new URL(input).searchParams.get("q") ?? "";
      return Response.json({
        records: query.includes(" FROM Organization ")
          ? [
              {
                Id: query.includes("00D000000000002") ? "00D000000000002" : "00D000000000001",
                Name: "Fictional Production",
                IsSandbox: false,
                OrganizationType: "Developer Edition",
              },
            ]
          : [
              {
                Id: query.includes("005000000000002") ? "005000000000002" : "005000000000001",
                Username: query.includes("005000000000002")
                  ? "other@fictional.example"
                  : "alex@fictional.example",
              },
            ],
      });
    }),
  );
  let runtime = makeHeadfulRuntime({ homeDir, cli });
  const authority = { kind: "desktop" } as const;
  try {
    const detection = await runtime.dispatch("cli.detect", {}, authority);
    expect(detection).toMatchObject({
      selected: executable,
      minimumVersion: HEADFUL_MINIMUM_SALESFORCE_CLI_VERSION,
    });
    const discovered = await runtime.dispatch("orgs.discover", {}, authority);
    expect(discovered.connections.map((row) => row.environment)).toEqual(["production", "scratch"]);
    expect(JSON.stringify(discovered)).not.toContain("fixture-secret");
    const imported = await runtime.dispatch(
      "orgs.import",
      { username: "alex@fictional.example" },
      authority,
    );
    expect(imported).toMatchObject({
      agentEnabled: false,
      environment: "developer",
      principalId: "005000000000001",
    });
    await runtime.dispatch("orgs.update", { orgId: imported.id, agentEnabled: true }, authority);
    const reconnected = await runtime.dispatch(
      "orgs.login",
      { environment: "production" },
      authority,
    );
    expect(reconnected).toMatchObject({ agentEnabled: false, principalId: "005000000000002" });
    expect(reconnected.id).not.toBe(imported.id);
    const state = await runtime.dispatch("orgs.list", {}, authority);
    expect(state.orgs).toHaveLength(2);
    expect(state.orgs.find((row) => row.id === imported.id)?.agentEnabled).toBe(true);
    expect(JSON.stringify(state)).not.toContain("fixture-secret");
    await runtime.dispatch("onboarding.complete", { mode: "minimal" }, authority);
    await runtime.close();
    runtime = makeHeadfulRuntime({ homeDir, cli: new CliAdapter(executable) });
    expect(await runtime.dispatch("features.list", {}, authority)).toHaveProperty(
      "onboardingComplete",
      true,
    );
    expect((await runtime.dispatch("orgs.list", {}, authority)).orgs[0]).toMatchObject({
      id: imported.id,
      environment: "developer",
      agentEnabled: true,
    });
    await expect(runtime.dispatch("orgs.discover", {}, { kind: "mcp" })).rejects.toThrow();
  } finally {
    await runtime.close();
    vi.unstubAllGlobals();
    NodeFS.rmSync(homeDir, { recursive: true, force: true });
  }
});
