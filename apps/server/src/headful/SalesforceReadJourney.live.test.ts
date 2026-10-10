// @effect-diagnostics nodeBuiltinImport:off globalFetch:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { startRuntimeHost } from "./RuntimeHost.ts";
import { CliAdapter } from "./SalesforceCli.ts";
import { currentIso } from "./domain/security.ts";
import {
  headfulResultSchemas,
  type HeadfulOperation,
} from "../../../../packages/contracts/src/headful.ts";

const alias = process.env.HEADFUL_SF_LIVE_ORG;
const hub = process.env.HEADFUL_SF_DEV_HUB;

/** Never forward raw CLI output or subprocess errors containing auth material into test logs. */
function scratchInventory(): Promise<unknown> {
  return new Promise((done, reject) => {
    NodeChildProcess.execFile(
      "sf",
      ["org", "list", "--json"],
      { timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        try {
          if (error) throw new Error();
          const envelope = z
            .object({ status: z.literal(0), result: z.unknown() })
            .parse(JSON.parse(stdout));
          done(envelope.result);
        } catch {
          reject(new Error("Salesforce CLI could not verify the scratch inventory."));
        }
      },
    );
  });
}

it.skipIf(!alias)(
  "reads real scratch-org licenses through signed RPC → native runtime → CLI auth → native Salesforce fetch",
  async () => {
    if (!alias || !/^HF-SCRATCH-[A-Za-z0-9-]+$/.test(alias) || hub !== "ai-devs")
      throw new Error(
        "Live verification requires an explicit HF-SCRATCH alias and approved Dev Hub.",
      );
    const inventory = z
      .object({
        nonScratchOrgs: z.array(z.object({ alias: z.string().optional(), username: z.string() })),
        scratchOrgs: z.array(
          z.object({
            alias: z.string().optional(),
            orgId: z.string(),
            username: z.string(),
            devHubUsername: z.string(),
            isExpired: z.boolean(),
          }),
        ),
      })
      .parse(await scratchInventory());
    const devHub = inventory.nonScratchOrgs.find(
      (candidate) => candidate.alias === hub || candidate.username === hub,
    );
    const scratch = inventory.scratchOrgs.find((candidate) => candidate.alias === alias);
    if (!devHub || !scratch || scratch.isExpired || scratch.devHubUsername !== devHub.username)
      throw new Error(
        "The selected org is not an active scratch org owned by the approved Dev Hub.",
      );

    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "headful-live-read-"));
    const key = NodeCrypto.randomBytes(32);
    const nativeFetch = globalThis.fetch;
    const session = vi.spyOn(CliAdapter.prototype, "session");
    const requests: Array<{ path: string; status: number; durationMs: number }> = [];
    const steps: Array<{
      operation: string;
      durationMs: number;
      cliResolutions: number;
      providerRequests: number;
    }> = [];
    let host: Awaited<ReturnType<typeof startRuntimeHost>> | undefined;
    let status: "passed" | "failed" = "failed";
    let groupCounts: Array<{ kind: string; count: number }> = [];
    const hash = NodeCrypto.createHash("sha256");
    const sources = [
      "apps/server/src/headful/SalesforceHttp.ts",
      "apps/server/src/headful/SalesforceCli.ts",
      "apps/server/src/headful/OrgService.ts",
      "apps/server/src/headful/OrgInsights.ts",
      "apps/server/src/headful/WorkspaceService.ts",
      "apps/server/src/headful/RuntimeHost.ts",
      "apps/server/src/headful/SalesforceReadJourney.live.test.ts",
      "packages/contracts/src/headful-cli-policy.ts",
      "packages/contracts/src/headful-org-insights.ts",
    ];
    for (const source of sources)
      hash
        .update(source)
        .update(await NodeFSP.readFile(new URL(`../../../../${source}`, import.meta.url)));
    const sourceDigest = hash.digest("hex");
    try {
      // Observe the actual native fetch; this wrapper never substitutes provider responses.
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.protocol === "https:") {
          const method = init?.method ?? (input instanceof Request ? input.method : "GET");
          if (method.toUpperCase() !== "GET")
            throw new Error("Live read journey refused a provider mutation.");
          expect(init?.redirect).toBe("error");
          expect(init?.cache).toBe("no-store");
          expect(new Headers(init?.headers).get("accept")).toBe("application/json");
          const started = performance.now();
          const response = await nativeFetch(input, init);
          requests.push({
            path: url.pathname,
            status: response.status,
            durationMs: Math.round(performance.now() - started),
          });
          return response;
        }
        return nativeFetch(input, init);
      });
      host = await startRuntimeHost(directory, { desktopCapability: key.toString("base64url") });
      const rpc = async <K extends HeadfulOperation>(operation: K, input: unknown) => {
        const body = JSON.stringify({ operation, input });
        const signature = NodeCrypto.createHmac("sha256", key).update(body).digest("base64url");
        const started = performance.now(),
          beforeCli = session.mock.calls.length,
          beforeRequests = requests.length;
        const response = await nativeFetch(host!.origin + "/rpc", {
          method: "POST",
          headers: { "content-type": "application/json", "x-headful-desktop-signature": signature },
          body,
          signal: AbortSignal.timeout(60000),
        });
        expect(response.headers.get("cache-control")).toBe("no-store");
        const envelope = z
          .object({ result: z.unknown().optional(), error: z.string().optional() })
          .parse(await response.json());
        if (response.status !== 200)
          throw new Error(
            `${operation} failed: ${envelope.error ?? "runtime rejected the request"}`,
          );
        const result = headfulResultSchemas[operation].parse(envelope.result);
        expect(JSON.stringify(result)).not.toMatch(
          /accessToken|access_token|refresh_token|"authorization"/i,
        );
        steps.push({
          operation,
          durationMs: Math.round(performance.now() - started),
          cliResolutions: session.mock.calls.length - beforeCli,
          providerRequests: requests.length - beforeRequests,
        });
        return result as import("../../../../packages/contracts/src/headful.ts").HeadfulResult<K>;
      };
      const rejected = await nativeFetch(host.origin + "/rpc", {
        method: "POST",
        body: JSON.stringify({ operation: "status", input: {} }),
      });
      expect(rejected.status).toBe(401);
      expect(rejected.headers.get("cache-control")).toBe("no-store");
      await rejected.body?.cancel();
      const imported = await rpc("orgs.import", { username: scratch.username, alias });
      if (!("salesforceOrgId" in imported) || !("id" in imported))
        throw new Error("Import result is missing identity.");
      expect(imported.salesforceOrgId.slice(0, 15)).toBe(scratch.orgId.slice(0, 15));
      const orgId = imported.id;
      const overview = await rpc("orgs.overview", { orgId });
      if (!("trialExpirationDate" in overview) || !("org" in overview))
        throw new Error("Overview result is missing scratch evidence.");
      expect(overview.detailsAvailable).toBe(true);
      expect(overview.org.isSandbox).toBe(true);
      expect(overview.trialExpirationDate).toBeTruthy();
      const inventory = await rpc("orgs.licenses", { orgId });
      if (!("groups" in inventory) || !("org" in inventory))
        throw new Error("License result is missing inventory.");
      expect(inventory.org.salesforceOrgId.slice(0, 15)).toBe(scratch.orgId.slice(0, 15));
      expect(inventory.groups.map((group) => group.kind)).toEqual([
        "user",
        "permission-set",
        "package",
      ]);
      expect(inventory.groups.every((group) => group.availability === "available")).toBe(true);
      expect(inventory.groups[0]?.licenses.length).toBeGreaterThan(0);
      expect(inventory.groups.every((group) => group.licenses.length <= 500)).toBe(true);
      groupCounts = inventory.groups.map((group) => ({
        kind: group.kind,
        count: group.licenses.length,
      }));
      expect(steps.find((step) => step.operation === "orgs.licenses")?.cliResolutions).toBe(1);
      const metadataTypes = await rpc("orgs.metadata", { orgId });
      if (!("types" in metadataTypes))
        throw new Error("Metadata result is missing type discovery.");
      expect(metadataTypes.apiVersion).toBe("67.0");
      expect(metadataTypes.types.some((type) => type.name === "CustomObject")).toBe(true);
      const components = await rpc("orgs.metadata.components", { orgId, type: "CustomObject" });
      if (!("components" in components))
        throw new Error("Metadata result is missing component discovery.");
      expect(components).toMatchObject({
        apiVersion: "67.0",
        folder: null,
        completeness: "not-guaranteed",
      });
      expect(
        components.components.some((component) => component.name === "Headful_Project__c"),
      ).toBe(true);
      const reports = await rpc("orgs.metadata.components", {
        orgId,
        type: "Report",
        folder: "unfiled$public",
      });
      expect(reports).toMatchObject({
        apiVersion: "67.0",
        folder: "unfiled$public",
        completeness: "not-guaranteed",
      });
      const metadata = await NodeFSP.readFile(
        NodePath.join(directory, "desktop-session.json"),
        "utf8",
      );
      expect(metadata).not.toContain(key.toString("base64url"));
      status = "passed";
    } finally {
      await host?.close();
      vi.restoreAllMocks();
      await NodeFSP.rm(directory, { recursive: true });
      const report = {
        status,
        kind: "live read-only native service journey",
        checkedAt: currentIso(),
        alias,
        sourceDigest,
        sources,
        steps,
        groupCounts,
        providerRequests: requests,
        providerWrites: 0,
      };
      const output = process.env.HEADFUL_SF_READ_EVIDENCE;
      if (output) {
        await NodeFSP.mkdir(NodePath.resolve(output, ".."), { recursive: true });
        await NodeFSP.writeFile(NodePath.resolve(output), JSON.stringify(report, null, 2) + "\n", {
          mode: 0o600,
        });
      }
    }
  },
  120000,
);
