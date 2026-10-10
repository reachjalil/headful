/* oxlint-disable shadcn/no-unknown-classes -- Development isolate uses Headful's scoped workspace stylesheet. */
import { useEffect, useState } from "react";
import type { HeadfulResult } from "@t3tools/contracts/headful";
import type { ExperiencePreviewProps } from "../experience-views";
import { AdminWorkspace, adminTools } from "./AdminWorkspace";
import { createAdminFixture } from "./fixtures";
import "../salesforce-setup.css";

function Preview({
  fixture,
  step,
  onStepChange,
  replay,
  referenceMod = false,
  experienceId,
}: ExperiencePreviewProps & { replay: () => void; referenceMod?: boolean; experienceId?: string }) {
  const [dispatch] = useState(() => createAdminFixture(fixture, referenceMod));
  const [org, setOrg] = useState<HeadfulResult<"orgs.list">["orgs"][number] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mods, setMods] = useState<HeadfulResult<"mods.list">["mods"]>([]);
  const [features, setFeatures] = useState<HeadfulResult<"features.list">["features"]>([]);
  useEffect(() => {
    void Promise.all([
      dispatch("orgs.list", {}),
      dispatch("mods.list", {}),
      dispatch("features.list", {}),
    ]).then(([result, mods, features]) => {
      setOrg(result.orgs[0] ?? null);
      setMods(mods.mods);
      setFeatures(features.features);
      setLoaded(true);
    });
  }, [dispatch]);
  return (
    <main
      className="sf-admin-preview"
      {...(referenceMod
        ? {
            "data-experience": "reference-mod",
            "data-experience-step": "counter",
            "aria-busy": !loaded,
          }
        : experienceId
          ? { "data-experience": experienceId, "data-experience-step": step, "aria-busy": !loaded }
          : {})}
    >
      <div className="sf-fixture">
        DEVELOPMENT FIXTURE · FICTIONAL ORGS · NO SALESFORCE CALLS <span>{fixture}</span>
        <button onClick={replay}>Reset / replay</button>
      </div>
      {!loaded ? (
        <p role="status">Opening admin workspace…</p>
      ) : org ? (
        <>
          <header className="sf-admin-preview-heading">
            <strong>{org.label}</strong>
            <p>
              {org.username} · {org.salesforceOrgId} · Read only
            </p>
          </header>
          <AdminWorkspace
            org={org}
            dispatch={dispatch}
            mods={mods}
            features={features}
            initialTool={
              referenceMod
                ? "org.example.hello/counter"
                : adminTools.find((tool) => tool.id === step)?.id
            }
            onStepChange={referenceMod ? undefined : onStepChange}
          />
        </>
      ) : (
        <section data-experience="admin-workspace" data-experience-step="schema" aria-busy="false">
          <h1>Connect an org to use admin tools</h1>
          <p>Use Connections & CLI in Settings to enable a workspace.</p>
        </section>
      )}
    </main>
  );
}
export function AdminWorkspacePreview(props: ExperiencePreviewProps & { experienceId?: string }) {
  const [revision, setRevision] = useState(0);
  return <Preview key={revision} {...props} replay={() => setRevision((value) => value + 1)} />;
}
export function EditorModsPreview(props: ExperiencePreviewProps) {
  const [revision, setRevision] = useState(0);
  return (
    <Preview
      key={revision}
      {...props}
      referenceMod
      replay={() => setRevision((value) => value + 1)}
    />
  );
}
