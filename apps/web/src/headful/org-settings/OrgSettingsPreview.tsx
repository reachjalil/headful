/* oxlint-disable shadcn/no-unknown-classes -- Isolated org settings preview. */
import { useEffect, useState } from "react";
import type { HeadfulResult } from "@t3tools/contracts/headful";
import type { ExperiencePreviewProps } from "../experience-views";
import { OrgSettings, type SettingsPage } from "./OrgSettings";
import { createOrgSettingsFixture } from "./fixtures";
import { CliSetup } from "../CliSetup";

function Preview({
  fixture,
  step,
  onStepChange,
  replay,
}: ExperiencePreviewProps & { replay: () => void }) {
  const [dispatch] = useState(() => createOrgSettingsFixture(fixture));
  const [orgs, setOrgs] = useState<HeadfulResult<"orgs.list">["orgs"] | null>(null);
  const [cli, setCli] = useState<HeadfulResult<"cli.detect"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([dispatch("orgs.list", {}), dispatch("cli.detect", {})]).then(
      ([result, detected]) => {
        if (active) {
          setOrgs(result.orgs);
          setCli(detected);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [dispatch]);
  if (!orgs) return <div role="status">Opening org settings fixture…</div>;
  return (
    <main className="os-preview">
      <div className="os-preview-card">
        <OrgSettings
          orgs={orgs}
          initialPage={step as SettingsPage | undefined}
          dispatch={dispatch}
          modRecords={[]}
          onStepChange={onStepChange}
          banner={
            <div className="sf-fixture">
              DEVELOPMENT FIXTURE · FICTIONAL ORGS · NO SALESFORCE CALLS <span>{fixture}</span>
              <button onClick={replay}>Reset / replay</button>
            </div>
          }
          cli={
            <CliSetup
              cli={cli}
              busy={busy}
              recheck={() => {
                setBusy(true);
                setError(false);
                void dispatch("cli.detect", {})
                  .then(setCli)
                  .catch(() => setError(true))
                  .finally(() => setBusy(false));
              }}
              configure={(path) => {
                setBusy(true);
                setError(false);
                void dispatch("cli.configure", { path })
                  .then(setCli)
                  .catch(() => setError(true))
                  .finally(() => setBusy(false));
              }}
            />
          }
          connections={
            <div className="os-notice">
              <p>
                Full-page Settings reuses Salesforce CLI readiness and the org connection component
                from onboarding. This isolate focuses on org information.
              </p>
            </div>
          }
        />
        {error && <p role="alert">Could not check the CLI fixture.</p>}
      </div>
    </main>
  );
}
export function OrgSettingsPreview(props: ExperiencePreviewProps) {
  const [revision, setRevision] = useState(0);
  return <Preview key={revision} {...props} replay={() => setRevision((value) => value + 1)} />;
}
