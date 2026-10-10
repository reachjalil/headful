import { useState } from "react";
import { SalesforceSetup } from "./SalesforceSetup";
import type { ExperiencePreviewProps } from "./experience-views";
import { createAdminFixture } from "./admin-workspace/fixtures";

export function SetupPreview({ fixture, step, onStepChange }: ExperiencePreviewProps) {
  const initialStep = (["welcome", "cli", "orgs", "workspace"] as const).find(
    (name) => name === step,
  );
  const [revision, setRevision] = useState(0);
  const [dispatch, setDispatch] = useState(() => createAdminFixture(fixture));
  return (
    <SalesforceSetup
      key={revision}
      dispatch={dispatch}
      fixture={fixture}
      initialStep={initialStep ?? "welcome"}
      onStepChange={onStepChange}
      onReplay={() => {
        history.replaceState(
          { ...history.state, headfulOrgId: null, headfulNavigation: { view: "home" } },
          "",
        );
        setDispatch(() => createAdminFixture(fixture));
        setRevision((value) => value + 1);
      }}
    />
  );
}
