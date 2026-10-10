/* oxlint-disable shadcn/no-unknown-classes -- Focused Headful surface uses the scoped setup stylesheet. */
import { useState } from "react";
import type { ExperiencePreviewProps } from "../experience-views";
import { createLeadFixture } from "./fixtures";
import { LeadReview } from "./LeadReview";

export function LeadReviewPreview({ fixture, onStepChange }: ExperiencePreviewProps) {
  const [revision, setRevision] = useState(0);
  return (
    <LeadReview
      key={revision}
      dispatch={createLeadFixture(fixture)}
      onStepChange={onStepChange}
      banner={
        <div className="sf-fixture">
          DEVELOPMENT FIXTURE · FICTIONAL LEADS · NO SALESFORCE CALLS <span>{fixture}</span>
          <button onClick={() => setRevision((value) => value + 1)}>Reset / replay</button>
        </div>
      }
    />
  );
}
