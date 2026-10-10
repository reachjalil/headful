/* oxlint-disable shadcn/no-unknown-classes -- Isolated org settings preview. */
import { useEffect, useState } from "react";
import type { HeadfulResult } from "@t3tools/contracts/headful";
import type { ExperiencePreviewProps } from "../experience-views";
import { OrgSettings, type SettingsPage } from "./OrgSettings";
import { createOrgSettingsFixture } from "./fixtures";

function Preview({
  fixture,
  step,
  onStepChange,
  replay,
}: ExperiencePreviewProps & { replay: () => void }) {
  const [dispatch] = useState(() => createOrgSettingsFixture(fixture));
  const [orgs, setOrgs] = useState<HeadfulResult<"orgs.list">["orgs"] | null>(null);
  useEffect(() => {
    let active = true;
    void dispatch("orgs.list", {}).then((result) => {
      if (active) setOrgs(result.orgs);
    });
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
          connections={
            <div className="os-notice">
              <p>
                Full-page Settings reuses Salesforce CLI readiness and the org connection component
                from onboarding. This isolate focuses on org information.
              </p>
            </div>
          }
        />
      </div>
    </main>
  );
}
export function OrgSettingsPreview(props: ExperiencePreviewProps) {
  const [revision, setRevision] = useState(0);
  return <Preview key={revision} {...props} replay={() => setRevision((value) => value + 1)} />;
}
