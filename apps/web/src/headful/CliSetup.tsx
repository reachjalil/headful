/* oxlint-disable shadcn/no-unknown-classes -- Focused Headful setup surface. */
import { Check, ExternalLink, RefreshCw, Terminal } from "lucide-react";
import type { HeadfulResult } from "@t3tools/contracts/headful";
import { salesforceCliInstallUrl, salesforceCliUpgradeUrl } from "./setup-service";
import { SettingsDisclosure } from "./org-settings/SettingsDisclosure";

export function CliSetup({
  cli,
  busy,
  recheck,
  configure,
}: {
  cli: HeadfulResult<"cli.detect"> | null;
  busy: boolean;
  recheck: () => void;
  configure: (path: string) => void;
}) {
  const ready = Boolean(cli?.selected && ["ready", "multiple"].includes(cli.state));
  const upgrade = cli?.state === "unsupported" || cli?.legacyDetected;
  return (
    <section className="sf-cli-setup" aria-label="Salesforce CLI setup">
      <section className="sf-cli-card" aria-label="Salesforce CLI status">
        <div className={`sf-cli-icon ${ready ? "sf-cli-ready" : ""}`}>
          {ready ? <Check size={20} /> : <Terminal size={20} />}
        </div>
        <div>
          <h2>
            {!cli
              ? "Checking Salesforce CLI…"
              : ready
                ? "Salesforce CLI is ready"
                : upgrade
                  ? "Upgrade Salesforce CLI"
                  : "Install Salesforce CLI"}
          </h2>
          <p>
            {!cli
              ? "Looking for the CLI on this Mac."
              : ready
                ? cli.installations.find((i) => i.path === cli.selected)?.version
                : `Headful requires Salesforce CLI ${cli.minimumVersion} or newer.`}
          </p>
        </div>
        <button
          className="sf-secondary"
          aria-label="Recheck Salesforce CLI"
          disabled={busy}
          onClick={recheck}
        >
          <RefreshCw size={14} className={busy ? "sf-spin" : ""} /> Recheck
        </button>
      </section>
      {cli && !ready && (
        <section className="sf-setting-card">
          <div className="sf-setting-card-body">
            <h3>{upgrade ? "Update your existing installation" : "Set up the CLI on your Mac"}</h3>
            <p>Salesforce CLI handles your org logins and keeps credentials on this Mac.</p>
            <ol className="sf-install-steps">
              <li>
                <strong>
                  {upgrade ? "Follow the update instructions" : "Get the macOS installer"}
                </strong>
                <span>
                  {upgrade
                    ? "Use the same method you used to install the CLI."
                    : "Choose Apple Silicon or Intel for your Mac on Salesforce’s download page."}
                </span>
              </li>
              <li>
                <strong>{upgrade ? "Complete the update" : "Run the installer"}</strong>
                <span>Follow the prompts, then reopen any Terminal windows.</span>
              </li>
              <li>
                <strong>Return to Headful</strong>
                <span>We check again when Headful regains focus. You can also press Recheck.</span>
              </li>
            </ol>
            <a
              className="sf-primary"
              href={upgrade ? salesforceCliUpgradeUrl : salesforceCliInstallUrl}
              target="_blank"
              rel="noreferrer"
            >
              {upgrade ? "Upgrade at Salesforce" : "Install from Salesforce"}{" "}
              <ExternalLink size={14} />
            </a>
          </div>
          <footer>
            Install with one method. Mixing the installer and npm can create conflicting CLI paths.
          </footer>
        </section>
      )}
      {cli && (
        <SettingsDisclosure
          id="cli-installation"
          title="Installation details"
          hint={`Minimum ${cli.minimumVersion}`}
        >
          {cli.selected ? (
            <>
              <p>Selected executable</p>
              <code>{cli.selected}</code>
            </>
          ) : (
            <p>No supported CLI executable is selected.</p>
          )}
          {cli.state === "multiple" && (
            <label className="sf-cli-select">
              CLI installation
              <select
                value={cli.selected ?? ""}
                disabled={busy}
                onChange={(event) => configure(event.target.value)}
              >
                {cli.installations
                  .filter((i) => i.supported)
                  .map((i) => (
                    <option key={i.path} value={i.path}>
                      {i.path} · {i.version}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <p>The legacy sfdx CLI is not supported. Headful requires the sf CLI.</p>
        </SettingsDisclosure>
      )}
      <SettingsDisclosure
        id="cli-help"
        title="Troubleshooting & other install methods"
        hint="PATH, npm and updates"
      >
        <p>
          If the CLI is installed but not detected, check that <code>sf --version</code> works in a
          new Terminal window, then restart Headful.
        </p>
        <p>
          For npm installations, use Salesforce’s Node.js requirements and permission guidance.
          Avoid installing a second copy to fix detection.
        </p>
        <div className="sf-guide-links">
          <a href={salesforceCliInstallUrl} target="_blank" rel="noreferrer">
            Installation guide <ExternalLink size={13} />
          </a>
          <a href={salesforceCliUpgradeUrl} target="_blank" rel="noreferrer">
            Update guide <ExternalLink size={13} />
          </a>
        </div>
      </SettingsDisclosure>
    </section>
  );
}
