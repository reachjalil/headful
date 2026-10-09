import { useState } from "react";
import { headfulUtilityResultSchemas } from "@t3tools/contracts/headful-utilities";
import { UtilityPanel, useUtilityTask } from "./primitives";
import type { UtilityComponentProps } from "./types";

/** Cloud execution remains an explicitly separate authenticated login, never a CLI credential transfer. */
export function BackupRecovery(props: UtilityComponentProps) {
  const task = useUtilityTask();
  const [location, setLocation] = useState<string | null>(null);
  return (
    <UtilityPanel
      title="Backup & Recovery"
      description="Protect selected Salesforce data with the Headful Cloud executor."
      busy={task.busy}
      error={task.error}
      actions={
        <button
          className="hf-button"
          data-testid="admin-backup-connect"
          disabled={task.busy}
          onClick={() =>
            void task.run(
              async () =>
                headfulUtilityResultSchemas["utilities.backup.location"].parse(
                  await props.dispatch("utilities.backup.location", { orgId: props.orgId }),
                ),
              (result) => setLocation(result.url),
            )
          }
        >
          Choose cloud protection
        </button>
      }
    >
      <div className="hf-utility-scroll">
        <p className="hf-note">
          Cloud backups continue without this Mac or an open browser. Sign in to Headful Cloud and
          explicitly connect the Salesforce login you want to protect. This workspace selection is a
          matching hint; it grants no cloud access and approves no restore.
        </p>
        <table className="hf-table">
          <thead><tr><th>Admin job</th><th>Cloud editor</th></tr></thead>
          <tbody>
            <tr><td>Configure protection and recurring capture</td><td>Protection</td></tr>
            <tr><td>Back up now; inspect latest verified coverage</td><td>Recovery points</td></tr>
            <tr><td>Find a record/file and compare captured values</td><td>Recovery points / Selection</td></tr>
            <tr><td>Review exact fields, dependencies and consequences</td><td>Restore review</td></tr>
            <tr><td>Inspect provider receipts and unresolved failures</td><td>Results</td></tr>
          </tbody>
        </table>
        {location && (
          <p>
            <a className="hf-button" href={location} target="_blank" rel="noreferrer" data-testid="admin-backup-open">
              Open authenticated cloud editor ↗
            </a>
          </p>
        )}
        <p className="hf-note">
          Native backup execution and embedded cloud-session bridging are not available in this
          destination. Cloud service rollout and storage configuration are required. No recovery or
          whole-org protection is claimed from opening this view.
        </p>
      </div>
    </UtilityPanel>
  );
}
