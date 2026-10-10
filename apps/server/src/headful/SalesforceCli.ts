/* oxlint-disable t3code/no-global-process-runtime -- Native CLI adapter intentionally owns Mac process architecture outside Effect. */
// @effect-diagnostics-next-line nodeBuiltinImport:off - native process/SQLite adapter owned by the scoped Headful runtime.
import * as NodeChildProcess from "node:child_process";
// @effect-diagnostics-next-line nodeBuiltinImport:off - native process/SQLite adapter owned by the scoped Headful runtime.
import * as NodeFSP from "node:fs/promises";
// @effect-diagnostics-next-line nodeBuiltinImport:off - native process/SQLite adapter owned by the scoped Headful runtime.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off - native process/SQLite adapter owned by the scoped Headful runtime.
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import { z } from "zod";
import {
  HEADFUL_MINIMUM_SALESFORCE_CLI_VERSION,
  HEADFUL_SALESFORCE_API_VERSION,
  supportsSalesforceCli,
} from "@t3tools/contracts/headful";
import { HttpError } from "./domain/types.ts";
import { readOnlySoql } from "./utilities/soql.ts";

export interface CliInstallation {
  path: string;
  version: string;
  supported: boolean;
  source: "configured" | "path" | "common";
}
export interface CliDetection {
  minimumVersion: string;
  state: "missing" | "ready" | "unsupported" | "multiple";
  installations: CliInstallation[];
  selected: string | null;
  installerUrl: string;
  architecture: string;
  legacyDetected: boolean;
}
export interface CliSession {
  orgId: string;
  username: string;
  instanceOrigin: string;
  accessToken: string;
  userId: string | null;
}
const sessionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/),
  username: z.string().min(1).max(255),
  instanceUrl: z.url(),
  userId: z.string().nullable().optional(),
});
const accessTokenSchema = z.object({
  accessToken: z
    .string()
    .min(10)
    .max(32000)
    .refine(
      (value) => !/\s|\[REDACTED\]|\[HIDDEN\]/i.test(value),
      "Salesforce CLI did not return a usable access token.",
    ),
});
const safePrincipal = z
  .string()
  .min(1)
  .max(255)
  // oxlint-disable-next-line no-control-regex -- CLI targets must reject control characters.
  .regex(/^[^\s\x00-\x1f]+$/);
export function salesforceOrigin(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.port ||
    u.username ||
    u.password ||
    !["salesforce.com", "force.com", "salesforce.mil"].some(
      (domain) => u.hostname === domain || u.hostname.endsWith("." + domain),
    )
  )
    throw new HttpError(
      400,
      "salesforce_origin",
      "Use a Salesforce HTTPS login or My Domain address.",
    );
  return u.origin;
}
/** Only allowlisted methods call this adapter. Raw CLI payloads remain in the server. */
export class CliAdapter {
  private executable: string | null = null;
  private discoveredKinds = new Map<
    string,
    "production" | "sandbox" | "scratch" | "developer" | "unknown"
  >();
  private readonly children = new Set<ReturnType<typeof NodeChildProcess.spawn>>();
  private readonly credentialFragments = new Set<string>();
  private safeUtilityResult(raw: unknown): unknown {
    let serialized = JSON.stringify(raw);
    for (const credential of this.credentialFragments)
      serialized = serialized.replaceAll(JSON.stringify(credential).slice(1, -1), "[REDACTED]");
    return JSON.parse(serialized);
  }
  private terminate(child: ReturnType<typeof NodeChildProcess.spawn>) {
    child.kill("SIGTERM");
    // @effect-diagnostics-next-line globalTimers:off - SIGKILL is limited to this adapter's exact spawned child after graceful termination.
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 2000);
    timer.unref();
    child.once("close", () => clearTimeout(timer));
  }
  private configuredPath: string | null;
  constructor(configuredPath: string | null = null) {
    this.configuredPath = configuredPath;
  }
  private async runAt(
    executable: string,
    args: string[],
    timeout = 30000,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (signal?.aborted)
      throw new HttpError(409, "cli_cancelled", "This Salesforce read was cancelled.");
    return new Promise((resolve, reject) => {
      const child = NodeChildProcess.spawn(executable, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: [
            process.env.PATH ?? "",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
          ].join(NodePath.delimiter),
          SF_DISABLE_TELEMETRY: "true",
          SFDX_DISABLE_TELEMETRY: "true",
          SF_AUTOUPDATE_DISABLE: "true",
          SF_ORG_MAX_QUERY_LIMIT: "501",
        },
      });
      this.children.add(child);
      let output = "",
        bytes = 0,
        settled = false;
      const decoder = new TextDecoder();
      const fail = (code: string) => {
        if (settled) return;
        settled = true;
        this.terminate(child);
        reject(
          new HttpError(
            code === "cli_cancelled" ? 409 : 502,
            code,
            code === "cli_cancelled"
              ? "This Salesforce read was cancelled."
              : code === "cli_timeout"
                ? "Salesforce CLI timed out. Check its authentication state and recheck."
                : "Salesforce CLI could not complete this operation. Check CLI setup or reconnect the org.",
          ),
        );
      };
      // @effect-diagnostics-next-line globalTimers:off - bound the native subprocess lifetime, including non-JSON failures.
      const timer = setTimeout(() => fail("cli_timeout"), timeout);
      const abort = () => fail("cli_cancelled");
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      child.stdout?.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) fail("cli_output_bound");
        else output += decoder.decode(chunk, { stream: true });
      });
      // stderr can contain auth URLs and credentials: never retain or return it.
      child.stderr?.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) fail("cli_output_bound");
      });
      child.once("error", () => fail("cli_unavailable"));
      child.once("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.children.delete(child);
        if (settled) return;
        settled = true;
        try {
          const parsed = JSON.parse(output + decoder.decode()) as {
            status?: number;
            result?: unknown;
            name?: string;
          };
          if (code !== 0 || (parsed.status && parsed.status !== 0)) {
            const failures: Record<string, [string, string]> = {
              MALFORMED_QUERY: [
                "cli_query_invalid",
                "Salesforce rejected the SOQL syntax. Check the selected fields and query clauses.",
              ],
              INVALID_FIELD: [
                "cli_field_unavailable",
                "A selected field is unavailable. Check its API name and field permissions.",
              ],
              INVALID_TYPE: [
                "cli_object_unavailable",
                "This object is unavailable. Check its API name and the connection's permissions.",
              ],
              INVALID_SESSION_ID: [
                "cli_reconnect_required",
                "Salesforce rejected this CLI session. Reconnect the selected org.",
              ],
              INSUFFICIENT_ACCESS_OR_READONLY: [
                "cli_access_denied",
                "This CLI connection does not have permission to read the selected Salesforce data.",
              ],
            };
            const known = parsed.name ? failures[parsed.name] : undefined;
            if (known) {
              reject(new HttpError(502, known[0], known[1]));
              return;
            }
            throw new Error("CLI rejection");
          }
          resolve(parsed.result ?? parsed);
        } catch {
          reject(
            new HttpError(
              502,
              "cli_rejected",
              "Salesforce CLI rejected the operation. Check authorization, permissions, and CLI version.",
            ),
          );
        }
      });
    });
  }
  async detect(): Promise<CliDetection> {
    const options: [string, CliInstallation["source"]][] = [];
    if (this.configuredPath) options.push([this.configuredPath, "configured"]);
    for (const folder of (process.env.PATH ?? "").split(NodePath.delimiter).filter(Boolean))
      options.push([NodePath.join(folder, "sf"), "path"]);
    for (const path of [
      "/opt/homebrew/bin/sf",
      "/usr/local/bin/sf",
      NodePath.join(NodeOS.homedir(), ".local/bin/sf"),
      NodePath.join(NodeOS.homedir(), ".sf/bin/sf"),
    ])
      options.push([path, "common"]);
    const seen = new Set<string>(),
      installations: CliInstallation[] = [];
    for (const [path, source] of options) {
      try {
        await NodeFSP.access(path, NodeFS.constants.X_OK);
        const actual = await NodeFSP.realpath(path);
        if (seen.has(actual)) continue;
        seen.add(actual);
        const raw = await this.runAt(path, ["version", "--json"], 10000);
        const version =
          typeof raw === "string"
            ? raw
            : typeof raw === "object" && raw !== null
              ? String(
                  (raw as { cliVersion?: string; version?: string }).cliVersion ??
                    (raw as { version?: string }).version ??
                    "",
                )
              : "";
        installations.push({
          path,
          version: version.slice(0, 180),
          supported: supportsSalesforceCli(version),
          source,
        });
      } catch {
        /* Detection errors expose no raw output. */
      }
    }
    this.executable =
      (this.configuredPath
        ? installations.find((i) => i.path === this.configuredPath && i.supported)
        : installations.find((i) => i.supported)
      )?.path ?? null;
    let legacyDetected = false;
    for (const path of ["/opt/homebrew/bin/sfdx", "/usr/local/bin/sfdx"])
      try {
        await NodeFSP.access(path, NodeFS.constants.X_OK);
        legacyDetected = true;
      } catch {}
    const architecture = process.arch === "arm64" ? "Apple Silicon" : "Intel";
    return {
      minimumVersion: HEADFUL_MINIMUM_SALESFORCE_CLI_VERSION,
      state:
        this.executable && installations.filter((i) => i.supported).length > 1
          ? "multiple"
          : this.executable
            ? "ready"
            : installations.length
              ? "unsupported"
              : "missing",
      installations,
      selected: this.executable,
      installerUrl: `https://developer.salesforce.com/media/salesforce-cli/sf/channels/stable/sf-${process.arch === "arm64" ? "arm64" : "x64"}.pkg`,
      architecture,
      legacyDetected,
    };
  }
  async configure(path: string | null) {
    if (path !== null && (!NodePath.isAbsolute(path) || path.includes("\0")))
      throw new HttpError(400, "cli_path", "Choose an absolute Salesforce CLI executable path.");
    this.configuredPath = path;
    return this.detect();
  }
  private async run(args: string[], timeout = 30000, signal?: AbortSignal) {
    if (signal?.aborted)
      throw new HttpError(409, "cli_cancelled", "This Salesforce read was cancelled.");
    if (!this.executable) await this.detect();
    if (!this.executable)
      throw new HttpError(
        409,
        "cli_missing",
        "Install the supported Salesforce CLI, then recheck.",
      );
    return this.runAt(this.executable, args, timeout, signal);
  }
  async discover(includeExpired = false) {
    const raw = await this.run([
      "org",
      "list",
      ...(includeExpired ? ["--all", "--skip-connection-status"] : []),
      "--json",
    ]);
    const schema = z.object({
      nonScratchOrgs: z
        .array(
          z.object({
            orgId: z.string().optional(),
            username: z.string(),
            alias: z.string().optional(),
            instanceUrl: z.string().optional(),
            isSandbox: z.boolean().optional(),
            connectedStatus: z.string().optional(),
            organizationType: z.string().optional(),
          }),
        )
        .default([]),
      scratchOrgs: z
        .array(
          z.object({
            orgId: z.string().optional(),
            username: z.string(),
            alias: z.string().optional(),
            instanceUrl: z.string().optional(),
            expirationDate: z.string().optional(),
          }),
        )
        .default([]),
    });
    const result = schema.parse(raw);
    const discovery = {
      connections: [
        ...result.nonScratchOrgs.map((o) => ({
          ...o,
          environment:
            o.organizationType === "Developer Edition"
              ? "developer"
              : o.isSandbox === undefined
                ? "unknown"
                : o.isSandbox
                  ? "sandbox"
                  : "production",
        })),
        ...result.scratchOrgs.map((o) => ({ ...o, environment: "scratch" })),
      ].slice(0, 100),
      bounded: true,
    };
    this.discoveredKinds.clear();
    for (const connection of discovery.connections) {
      if (connection.orgId)
        this.discoveredKinds.set(
          `${connection.orgId.slice(0, 15)}:${connection.username}`,
          connection.environment as "production" | "sandbox" | "scratch" | "developer" | "unknown",
        );
    }
    return discovery;
  }
  discoveredEnvironment(orgId: string, username: string) {
    return this.discoveredKinds.get(`${orgId.slice(0, 15)}:${username}`);
  }
  async session(target: string, signal?: AbortSignal): Promise<CliSession> {
    safePrincipal.parse(target);
    const raw = sessionSchema.parse(
      await this.run(["org", "display", "--target-org", target, "--json"], 30000, signal),
    );
    safePrincipal.parse(raw.username);
    const instanceOrigin = salesforceOrigin(raw.instanceUrl);
    // Standard display output redacts secrets on current CLI versions. Retrieve only
    // the access token, pinned to the resolved username, never an SFDX auth URL/refresh token.
    const { accessToken } = accessTokenSchema.parse(
      await this.run(
        ["org", "auth", "show-access-token", "--target-org", raw.username, "--json"],
        30000,
        signal,
      ),
    );
    this.credentialFragments.add(accessToken);
    if (this.credentialFragments.size > 100)
      this.credentialFragments.delete(this.credentialFragments.values().next().value!);
    return {
      orgId: raw.id,
      username: raw.username,
      instanceOrigin,
      accessToken,
      userId: raw.userId ?? null,
    };
  }
  async login(input: {
    environment: "production" | "sandbox" | "my-domain";
    instanceOrigin?: string | undefined;
    alias?: string | undefined;
  }) {
    const origin =
      input.environment === "sandbox"
        ? "https://test.salesforce.com"
        : input.environment === "production"
          ? "https://login.salesforce.com"
          : salesforceOrigin(input.instanceOrigin ?? "");
    const args = ["org", "login", "web", "--instance-url", origin, "--json"];
    if (input.alias) {
      z.string()
        .regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/)
        .parse(input.alias);
      args.push("--alias", input.alias);
    }
    const raw = await this.run(args, 180000);
    const result = z.object({ username: z.string() }).parse(raw);
    return { username: result.username };
  }
  async open(target: string) {
    safePrincipal.parse(target);
    await this.run(["org", "open", "--target-org", target, "--json"]);
    return { opened: true };
  }
  /** Fixed identity endpoint through sf; no caller can supply a URL, method or header. */
  async utilityIdentity(target: string, signal?: AbortSignal) {
    safePrincipal.parse(target);
    const session = await this.session(target, signal);
    const identity = z
      .object({
        user_id: z.string().regex(/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/),
        organization_id: z.string().regex(/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/),
        preferred_username: safePrincipal,
      })
      .parse(
        await this.run(
          [
            "api",
            "request",
            "rest",
            "/services/oauth2/userinfo",
            "--method",
            "GET",
            "--target-org",
            target,
          ],
          30000,
          signal,
        ),
      );
    return {
      orgId: identity.organization_id,
      userId: identity.user_id,
      username: identity.preferred_username,
      instanceOrigin: session.instanceOrigin,
    };
  }
  async utilityQuery(target: string, query: string, signal?: AbortSignal) {
    safePrincipal.parse(target);
    z.string().min(1).max(21000).parse(query);
    readOnlySoql(query);
    return this.safeUtilityResult(
      await this.run(
        ["data", "query", "--query", query, "--target-org", target, "--json"],
        45000,
        signal,
      ),
    );
  }
  async utilityRecord(target: string, object: string, recordId: string, signal?: AbortSignal) {
    safePrincipal.parse(target);
    z.string()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/)
      .parse(object);
    z.string()
      .regex(/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/)
      .parse(recordId);
    return this.safeUtilityResult(
      await this.run(
        [
          "data",
          "get",
          "record",
          "--sobject",
          object,
          "--record-id",
          recordId,
          "--target-org",
          target,
          "--json",
        ],
        30000,
        signal,
      ),
    );
  }
  async utilityObjects(
    target: string,
    category: "all" | "standard" | "custom",
    signal?: AbortSignal,
  ) {
    safePrincipal.parse(target);
    z.enum(["all", "standard", "custom"]).parse(category);
    return this.run(
      ["sobject", "list", "--sobject", category, "--target-org", target, "--json"],
      30000,
      signal,
    );
  }
  async utilityDescribe(target: string, object: string, signal?: AbortSignal) {
    safePrincipal.parse(target);
    z.string()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/)
      .parse(object);
    return this.run(
      ["sobject", "describe", "--sobject", object, "--target-org", target, "--json"],
      30000,
      signal,
    );
  }
  async utilityLimits(target: string, signal?: AbortSignal) {
    safePrincipal.parse(target);
    return this.run(["org", "list", "limits", "--target-org", target, "--json"], 30000, signal);
  }
  async metadataTypes(target: string) {
    safePrincipal.parse(target);
    return this.run([
      "org",
      "list",
      "metadata-types",
      "--target-org",
      target,
      "--api-version",
      HEADFUL_SALESFORCE_API_VERSION,
      "--json",
    ]);
  }
  async metadataComponents(target: string, type: string, folder?: string) {
    safePrincipal.parse(target);
    z.string()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/)
      .parse(type);
    const args = [
      "org",
      "list",
      "metadata",
      "--metadata-type",
      type,
      "--target-org",
      target,
      "--api-version",
      HEADFUL_SALESFORCE_API_VERSION,
      "--json",
    ];
    if (folder) {
      z.string()
        .min(1)
        .max(200)
        .regex(/^[A-Za-z0-9_$][A-Za-z0-9_$ /-]{0,199}$/)
        .parse(folder);
      args.push("--folder", folder);
    }
    return this.run(args);
  }
  async utilityLogs(target: string, signal?: AbortSignal) {
    safePrincipal.parse(target);
    return this.run(["apex", "list", "log", "--target-org", target, "--json"], 30000, signal);
  }
  async utilityLog(target: string, logId: string, signal?: AbortSignal) {
    safePrincipal.parse(target);
    z.string()
      .regex(/^07L[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/)
      .parse(logId);
    // Without output-dir, the verified installed CLI returns [{log:string}] and writes no file.
    return this.safeUtilityResult(
      await this.run(
        ["apex", "get", "log", "--log-id", logId, "--target-org", target, "--json"],
        30000,
        signal,
      ),
    );
  }
  async utilityOpen(target: string, path: string) {
    safePrincipal.parse(target);
    if (
      !/^\/(?:lightning\/setup\/(?:SetupOneHome|ManageUsers|PermSets|ObjectManager)\/home|lightning\/page\/home|[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?)$/.test(
        path,
      )
    )
      throw new HttpError(400, "setup_path", "Choose a supported Salesforce destination.");
    await this.run(["org", "open", "--path", path, "--target-org", target, "--json"]);
    return { opened: true as const };
  }
  async logout(target: string) {
    safePrincipal.parse(target);
    await this.run(["org", "logout", "--target-org", target, "--no-prompt", "--json"]);
    return { loggedOut: true };
  }
  close() {
    for (const child of this.children) child.kill("SIGKILL");
    this.children.clear();
    this.credentialFragments.clear();
  }
}
export class SalesforceCli extends Context.Service<SalesforceCli, { readonly cli: CliAdapter }>()(
  "t3/headful/SalesforceCli",
) {}
export const layer = Layer.sync(SalesforceCli, () => SalesforceCli.of({ cli: new CliAdapter() }));
