/* oxlint-disable shadcn/no-unknown-classes -- Headful owns the settings guide layout. */
import { ArrowRight, ExternalLink } from "lucide-react";
import type { SettingsPage } from "./org-settings/settings-navigation";
import { SettingsDisclosure } from "./org-settings/SettingsDisclosure";

export function SetupGuide({ navigate }: { navigate: (page: SettingsPage) => void }) {
  return (
    <section className="sf-configuration-page" aria-labelledby="documentation-title">
      <div className="sf-page-title">
        <h2 id="documentation-title">Documentation</h2>
        <p>A short path from setup to your org workspace.</p>
      </div>
      <section className="sf-setting-card">
        <div className="sf-setting-card-body">
          <h3>Connect your first org</h3>
          <ol className="sf-install-steps">
            <li>
              <strong>Check Salesforce CLI</strong>
              <span>Install a supported CLI, or use the one already on this Mac.</span>
              <button className="sf-guide-action" onClick={() => navigate("cli")}>
                CLI setup <ArrowRight size={13} />
              </button>
            </li>
            <li>
              <strong>Choose the exact login</strong>
              <span>
                Use an existing CLI login or Add org. Sign in through your browser using Production,
                Sandbox, or My Domain.
              </span>
              <button className="sf-guide-action" onClick={() => navigate("connections")}>
                Manage connections <ArrowRight size={13} />
              </button>
            </li>
            <li>
              <strong>Enable access</strong>
              <span>
                Enable that login in Connections, then select it beside the helmet. Org switching
                keeps each login’s drafts and saved targets separate.
              </span>
            </li>
          </ol>
        </div>
        <footer>
          No Headful account is needed for local use. Salesforce CLI owns your credentials.
        </footer>
      </section>
      <SettingsDisclosure
        id="guide-access"
        title="Org access & agent permissions"
        hint="Exact login, explicit opt-in"
      >
        <p>
          Enabling a login makes its workspace available and permits agents within their granted
          access. Salesforce permissions still apply. Consequential provider changes require an
          exact reviewed action.
        </p>
        <p>
          Switching an org changes the visible workspace. It does not enable a disabled login,
          change your default org, or retarget saved work.
        </p>
      </SettingsDisclosure>
      <SettingsDisclosure
        id="guide-reconnect"
        title="Reconnect a login"
        hint="Missing or expired sessions"
      >
        <p>
          Open Connections and use the login’s connection options. Browser sign-in as a different
          Salesforce user creates a separate connection; existing work keeps its original identity.
        </p>
        <p>Expired scratch orgs need a new org. Reconnecting cannot extend their lifetime.</p>
      </SettingsDisclosure>
      <div className="sf-guide-links">
        <a href="https://headful.cloud/docs" target="_blank" rel="noreferrer">
          Headful documentation <ExternalLink size={13} />
        </a>
        <a
          href="https://developer.salesforce.com/docs/platform/sfdx-setup/guide/sfdx-setup.html"
          target="_blank"
          rel="noreferrer"
        >
          Salesforce CLI documentation <ExternalLink size={13} />
        </a>
      </div>
      <p className="sf-footnote">Headful is independent and is not affiliated with Salesforce.</p>
    </section>
  );
}
