/* oxlint-disable shadcn/no-unknown-classes -- Local tool management uses Headful's scoped settings stylesheet. */
import { ModControls } from "./ModControls";
import { useCallback, useEffect, useState } from "react";
import { headfulModsSchema, type HeadfulModDescriptor } from "@t3tools/contracts/headful-mods";
export function HeadfulMods({
  fixtureRecords,
}: { fixtureRecords?: HeadfulModDescriptor[] | undefined } = {}) {
  const [mods, setMods] = useState<HeadfulModDescriptor[]>(fixtureRecords ?? []),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [output, setOutput] = useState("");
  const dispatch = async (operation: string, input: unknown = {}) => {
    if (fixtureRecords)
      throw new Error(
        "Development fixture: installation and native permission review require the real Mac host.",
      );
    if (!window.headfulBridge) throw new Error("Open the Mac app to manage local mods.");
    return window.headfulBridge.dispatch(operation, input);
  };
  const load = useCallback(async () => {
    if (fixtureRecords) return;
    try {
      if (!window.headfulBridge) return;
      setMods(headfulModsSchema.parse(await window.headfulBridge.dispatch("mods.list", {})).mods);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read mods.");
    }
  }, [fixtureRecords]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      const result = await work();
      setOutput(typeof result === "object" ? JSON.stringify(result, null, 2) : String(result));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mod operation failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="os-content"
      aria-label="Local mods"
      data-testid="mods-management"
      data-experience="mod-management"
      data-experience-step="inspect"
      aria-busy={busy}
    >
      <div className="os-page-heading">
        <div>
          <h2>Local mods</h2>
          <p>Add tools to Headful. Review permissions on this Mac before enabling a mod.</p>
        </div>
        <div className="os-mod-actions">
          <button
            disabled={busy || !!fixtureRecords}
            data-testid="mods-install"
            onClick={() => void run(() => dispatch("system.mods.install"))}
          >
            Install local mod…
          </button>
          <button disabled={busy} onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>
      {!mods.length && <p>No mods installed. Install a .headfulmod file to add a tool.</p>}
      <div className="os-mod-list">
        {mods.map((mod) => (
          <article className="os-mod-row" key={mod.manifest.id}>
            <h3>
              {mod.manifest.name} <small>{mod.manifest.version}</small>
            </h3>
            <p>{mod.manifest.description}</p>
            <p>
              <span className="os-tag">{mod.status}</span> ·{" "}
              {mod.manifest.execution === "native" ? "Reviewed native code" : "Community sandbox"}
            </p>
            <details>
              <summary>Permissions & details</summary>
              <p>
                <code>{mod.manifest.id}</code> · {mod.manifest.license}
              </p>
              <p>Required: {mod.manifest.permissions.join(", ") || "None"}</p>
              <p>Granted: {mod.grantedPermissions.join(", ") || "None"}</p>
              <p>Optional: {mod.manifest.optionalPermissions.join(", ") || "None"}</p>
              <code>{mod.artifactRevision}</code>
              <p>
                Host API {mod.manifest.hostApi}; platforms {mod.manifest.platforms.join(", ")}.
              </p>
            </details>
            {mod.error && <p role="alert">{mod.error.message}</p>}
            {(mod.manifest.contributions.navigation.length > 0 ||
              mod.manifest.contributions.actions.length > 0) && (
              <details>
                <summary data-testid={`mods-editor-locations-${mod.manifest.id}`}>
                  Editor locations
                </summary>
                {mod.manifest.contributions.navigation.map((tool) => (
                  <p key={tool.id}>
                    <strong>{tool.name}</strong> ·{" "}
                    {mod.manifest.id === "headful.admin-utilities" ? "Tool strip" : "Tools menu"}
                  </p>
                ))}
                {mod.manifest.contributions.actions.map((action) => (
                  <p key={action.id}>
                    <strong>{action.name}</strong> ·{" "}
                    {action.placement === "primary"
                      ? "Tool toolbar (up to two actions)"
                      : "Tools menu"}
                    {action.workspaceIds.length
                      ? ` · ${action.workspaceIds.map((id) => mod.manifest.contributions.navigation.find((tool) => tool.id === id)?.name ?? id).join(", ")}`
                      : " · All tools"}
                  </p>
                ))}
              </details>
            )}
            <div className="os-mod-actions">
              <button
                disabled={busy || !!fixtureRecords}
                data-testid="mods-review"
                onClick={() =>
                  void run(() => dispatch("system.mods.permissions", { id: mod.manifest.id }))
                }
              >
                Review permissions…
              </button>
              <button
                disabled={busy || !!fixtureRecords}
                data-testid="mods-toggle"
                onClick={() =>
                  void run(() =>
                    dispatch(mod.enabled ? "mods.disable" : "mods.enable", { id: mod.manifest.id }),
                  )
                }
              >
                {mod.enabled ? "Disable" : "Enable"}
              </button>
            </div>
            <ModControls
              key={mod.artifactRevision}
              mod={mod}
              disabled={busy || !!fixtureRecords}
              dispatch={dispatch}
              run={run}
            />
            {mod.enabled && mod.manifest.activation.includes("background") && (
              <button
                disabled={busy || !!fixtureRecords}
                onClick={() =>
                  void run(() => dispatch("system.mods.background", { id: mod.manifest.id }))
                }
              >
                Start background subscription…
              </button>
            )}
            {mod.enabled &&
              mod.manifest.contributions.commands
                .filter((c) => c.parameters.length === 0)
                .map((command) => (
                  <button
                    key={command.id}
                    disabled={busy || !!fixtureRecords}
                    onClick={() =>
                      void run(() =>
                        dispatch("mods.command", {
                          id: mod.manifest.id,
                          command: command.id,
                          input: {},
                        }),
                      )
                    }
                  >
                    {command.name}
                  </button>
                ))}
            {mod.enabled &&
              mod.manifest.contributions.surfaces.map((view) => (
                <button
                  key={view.id}
                  disabled={busy || !!fixtureRecords}
                  onClick={() =>
                    void run(() =>
                      dispatch("mods.surface", { id: mod.manifest.id, surfaceId: view.id }),
                    )
                  }
                >
                  Open {view.name}
                </button>
              ))}
            <details>
              <summary>Remove mod or local data</summary>
              <div className="os-mod-actions">
                {" "}
                <button
                  disabled={busy || !!fixtureRecords}
                  onClick={() =>
                    void run(() => dispatch("system.mods.uninstall", { id: mod.manifest.id }))
                  }
                >
                  Uninstall…
                </button>
                <button
                  disabled={busy || !!fixtureRecords}
                  onClick={() =>
                    void run(() => dispatch("system.mods.deleteData", { id: mod.manifest.id }))
                  }
                >
                  Delete local mod data…
                </button>
              </div>
            </details>
          </article>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {output && (
        <details>
          <summary>Operation result</summary>
          <pre aria-label="Mod result">{output}</pre>
        </details>
      )}
    </section>
  );
}
