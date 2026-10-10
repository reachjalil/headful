/* oxlint-disable shadcn/no-unknown-classes -- Development isolate uses Headful's scoped settings stylesheet. */
import { useState } from "react";
import { headfulModDescriptorSchema } from "@t3tools/contracts/headful-mods";
import type { ExperiencePreviewProps } from "../experience-views";
import { HeadfulMods } from "../HeadfulMods";
import "../org-settings/org-settings.css";
import "../salesforce-setup.css";
import exampleRegistration from "../../../../../examples/hello-mod/headful.mod.json";
export { EditorModsPreview as ReferenceModPreview } from "../admin-workspace/AdminWorkspacePreview";
const fixture = headfulModDescriptorSchema.parse({
  manifest: {
    ...exampleRegistration,
    description: "Synthetic local counter; no credentials or provider connection.",
    source: "development",
  },
  enabled: false,
  compatible: true,
  status: "inactive",
  artifactRevision: "a".repeat(64),
  grantedPermissions: [],
});
export function ModManagementPreview({
  fixture: starting,
  step = "inspect",
}: ExperiencePreviewProps) {
  const [revision, setRevision] = useState(0);
  return (
    <main
      className="os-settings os-preview"
      aria-busy={false}
      data-experience="mod-management"
      data-experience-step={step}
    >
      <div className="os-preview-card">
        <header className="os-preview-heading">Local tools</header>
        <div className="sf-fixture" role="status">
          DEVELOPMENT FIXTURE · NATIVE PERMISSION REVIEW REQUIRES THE MAC HOST{" "}
          <span>{starting}</span>
          <button onClick={() => setRevision((value) => value + 1)}>Reset / replay</button>
        </div>
        <div className="os-main">
          <HeadfulMods key={revision} fixtureRecords={starting === "empty" ? [] : [fixture]} />
        </div>
      </div>
    </main>
  );
}
