// @effect-diagnostics-next-line nodeBuiltinImport:off - native process/SQLite adapter owned by the scoped Headful runtime.
import { spawn } from "node:child_process";
// @effect-diagnostics-next-line nodeBuiltinImport:off - native process/SQLite adapter owned by the scoped Headful runtime.
import { access, realpath } from "node:fs/promises";
// @effect-diagnostics-next-line nodeBuiltinImport:off - native process/SQLite adapter owned by the scoped Headful runtime.
import { constants } from "node:fs";
import { homedir } from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off - native process/SQLite adapter owned by the scoped Headful runtime.
import { delimiter, isAbsolute, join } from "node:path";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import { z } from "zod";
import { HttpError } from "./domain/types.ts";

export interface CliInstallation {
  path: string;
  version: string;
  supported: boolean;
  source: "configured" | "path" | "common";
}
export interface CliDetection {
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
  accessToken: z.string().min(10).max(32000),
  userId: z.string().nullable().optional(),
});
const safePrincipal = z
  .string()
  .min(1)
  .max(255)
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
  private readonly children = new Set<ReturnType<typeof spawn>>();
  private terminate(child: ReturnType<typeof spawn>) {
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
  private async runAt(executable: string, args: string[], timeout = 30000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
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
          ].join(delimiter),
          SF_DISABLE_TELEMETRY: "true",
          SFDX_DISABLE_TELEMETRY: "true",
          SF_AUTOUPDATE_DISABLE: "true",
        },
      });
      this.children.add(child);
      let output = "",
        bytes = 0,
        settled = false;
      const fail = (code: string) => {
        if (settled) return;
        settled = true;
        this.terminate(child);
        reject(
          new HttpError(
            502,
            code,
            code === "cli_timeout"
              ? "Salesforce CLI timed out. Check its authentication state and recheck."
              : "Salesforce CLI could not complete this operation. Check CLI setup or reconnect the org.",
          ),
        );
      };
      // @effect-diagnostics-next-line globalTimers:off - bound the native subprocess lifetime, including non-JSON failures.
      const timer = setTimeout(() => fail("cli_timeout"), timeout);
      child.stdout?.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) fail("cli_output_bound");
        else output += chunk.toString("utf8");
      });
      // stderr can contain auth URLs and credentials: never retain or return it.
      child.stderr?.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) fail("cli_output_bound");
      });
      child.once("error", () => fail("cli_unavailable"));
      child.once("close", (code) => {
        clearTimeout(timer);
        this.children.delete(child);
        if (settled) return;
        settled = true;
        try {
          const parsed = JSON.parse(output) as { status?: number; result?: unknown };
          if (code !== 0 || (parsed.status && parsed.status !== 0))
            throw new Error("CLI rejection");
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
    for (const folder of (process.env.PATH ?? "").split(delimiter).filter(Boolean))
      options.push([join(folder, "sf"), "path"]);
    for (const path of [
      "/opt/homebrew/bin/sf",
      "/usr/local/bin/sf",
      join(homedir(), ".local/bin/sf"),
      join(homedir(), ".sf/bin/sf"),
    ])
      options.push([path, "common"]);
    const seen = new Set<string>(),
      installations: CliInstallation[] = [];
    for (const [path, source] of options) {
      try {
        await access(path, constants.X_OK);
        const actual = await realpath(path);
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
        const match = version.match(/(?:@salesforce\/cli\/|sf\/)?(\d+)\.(\d+)\.(\d+)/);
        installations.push({
          path,
          version: version.slice(0, 180),
          supported: Boolean(
            match &&
            Number(match[1]) >= 2 &&
            !version.includes("sfdx-cli") &&
            /^(?:@salesforce\/cli\/|sf\/|\d+\.)/.test(version),
          ),
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
        await access(path, constants.X_OK);
        legacyDetected = true;
      } catch {}
    const architecture = process.arch === "arm64" ? "Apple Silicon" : "Intel";
    return {
      state:
        installations.filter((i) => i.supported).length > 1
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
    if (path !== null && (!isAbsolute(path) || path.includes("\0")))
      throw new HttpError(400, "cli_path", "Choose an absolute Salesforce CLI executable path.");
    this.configuredPath = path;
    return this.detect();
  }
  private async run(args: string[], timeout = 30000) {
    if (!this.executable) await this.detect();
    if (!this.executable)
      throw new HttpError(
        409,
        "cli_missing",
        "Install the supported Salesforce CLI, then recheck.",
      );
    return this.runAt(this.executable, args, timeout);
  }
  async discover() {
    const raw = await this.run(["org", "list", "--json", "--skip-connection-status"]);
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
    return {
      connections: [
        ...result.nonScratchOrgs.map((o) => ({
          ...o,
          environment:
            o.isSandbox === undefined ? "unknown" : o.isSandbox ? "sandbox" : "production",
        })),
        ...result.scratchOrgs.map((o) => ({ ...o, environment: "scratch" })),
      ].slice(0, 100),
      bounded: true,
    };
  }
  async session(target: string): Promise<CliSession> {
    safePrincipal.parse(target);
    const raw = sessionSchema.parse(
      await this.run(["org", "display", "--target-org", target, "--json"]),
    );
    return {
      orgId: raw.id,
      username: raw.username,
      instanceOrigin: salesforceOrigin(raw.instanceUrl),
      accessToken: raw.accessToken,
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
  async logout(target: string) {
    safePrincipal.parse(target);
    await this.run(["org", "logout", "--target-org", target, "--no-prompt", "--json"]);
    return { loggedOut: true };
  }
  close() {
    for (const child of this.children) child.kill("SIGKILL");
    this.children.clear();
  }
}
export class SalesforceCli extends Context.Service<SalesforceCli, { readonly cli: CliAdapter }>()(
  "t3/headful/SalesforceCli",
) {}
export const layer = Layer.sync(SalesforceCli, () => SalesforceCli.of({ cli: new CliAdapter() }));
