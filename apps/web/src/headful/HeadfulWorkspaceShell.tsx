import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  headfulUtilityResultSchemas,
  workspacePreferencesSchema,
} from "@t3tools/contracts/headful-utilities";
import {
  adminUtilityHeaderComponents,
  OrgCloud,
  orgEnvironment,
  type UtilityComponentProps,
} from "@headfulcloud/admin-utilities/web";
import type { resolveHeadfulContributions } from "@t3tools/contracts/headful-extensions";
import type { z } from "zod";
import {
  moveHeaderControl,
  resolveHeaderControls,
  type HeaderLayout,
} from "./workspace-preferences";
import "./workspace-shell.css";

type Contributions = ReturnType<typeof resolveHeadfulContributions>;
type Preferences = z.infer<typeof workspacePreferencesSchema>;
export interface WorkspaceCommand {
  id: string;
  name: string;
  description: string;
  disabled?: boolean;
  reason?: string | undefined;
  run(): void;
}

export function HeadfulWorkspaceShell({
  title,
  context,
  contributions,
  commands,
  children,
  pinned,
  native,
  compact = true,
}: {
  title: string;
  context: UtilityComponentProps;
  contributions: Contributions;
  commands: WorkspaceCommand[];
  children: ReactNode;
  pinned?: boolean;
  native?: boolean;
  compact?: boolean;
}) {
  const [preferences, setPreferences] = useState<Preferences>({
    global: { order: [], hidden: [] },
    overrides: {},
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [scope, setScope] = useState<"global" | "workspace">("workspace");
  const [draft, setDraft] = useState<HeaderLayout>({ order: [], hidden: [] });
  const [palette, setPalette] = useState(false);
  const [search, setSearch] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const customizeDialog = useRef<HTMLDialogElement>(null);
  const paletteDialog = useRef<HTMLDialogElement>(null);
  const focusReturn = useRef<HTMLElement | null>(null);
  const customizeTrigger = useRef<HTMLButtonElement>(null);
  const org = context.orgs.find((item) => item.id === context.orgId);
  const controls = useMemo(
    () =>
      contributions.headerControls
        .filter(
          (item) =>
            item.available &&
            (item.contribution.workspaceIds.length === 0 ||
              item.contribution.workspaceIds.includes(context.workspaceId)),
        )
        .map(({ contribution }) => contribution),
    [contributions.headerControls, context.workspaceId],
  );
  const layout = preferences.overrides[context.workspaceId] ?? preferences.global;
  const resolved = resolveHeaderControls(controls, layout);
  const draftControls = resolveHeaderControls(controls, draft);
  const matches = commands.filter((command) =>
    `${command.name} ${command.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  const openPalette = useCallback(() => {
    focusReturn.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSearch("");
    setPaletteIndex(0);
    setPalette(true);
  }, []);
  useEffect(() => {
    let current = true;
    void context
      .dispatch("preferences.get", {})
      .then((result) => {
        if (current) {
          setPreferences(headfulUtilityResultSchemas["preferences.get"].parse(result).workspace);
          setPreferencesReady(true);
        }
      })
      .catch((error) => {
        if (current)
          setError(
            error instanceof Error ? error.message : "Workspace preferences are unavailable.",
          );
      });
    return () => {
      current = false;
    };
  }, [context.dispatch]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [openPalette]);
  useEffect(() => {
    const dialog = customizeDialog.current;
    if (customize && dialog && !dialog.open) dialog.showModal();
    else if (!customize && dialog?.open) {
      dialog.close();
      customizeTrigger.current?.focus();
    }
  }, [customize]);
  useEffect(() => {
    const dialog = paletteDialog.current;
    if (palette && dialog && !dialog.open) dialog.showModal();
    else if (!palette && dialog?.open) {
      dialog.close();
      focusReturn.current?.focus();
    }
  }, [palette]);
  const draftFor = (next: "global" | "workspace") => {
    const target =
      next === "global"
        ? preferences.global
        : (preferences.overrides[context.workspaceId] ?? preferences.global);
    const rows = resolveHeaderControls(controls, target);
    setScope(next);
    setDraft({
      order: rows.map((row) => row.id),
      hidden: rows.filter((row) => !row.visible).map((row) => row.id),
    });
  };
  const save = async (next: Preferences) => {
    setBusy(true);
    setError("");
    try {
      const result = headfulUtilityResultSchemas["preferences.set"].parse(
        await context.dispatch("preferences.set", { workspace: next }),
      );
      setPreferences(result.workspace);
      setCustomize(false);
      context.onFeedback("Workspace header preferences saved on your Mac.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The workspace preferences could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  const saveDraft = () => {
    const previous =
      scope === "global" ? preferences.global : preferences.overrides[context.workspaceId];
    const availableIds = new Set(controls.map((control) => control.id));
    const next = {
      order: [...draft.order, ...(previous?.order.filter((id) => !availableIds.has(id)) ?? [])],
      hidden: [...draft.hidden, ...(previous?.hidden.filter((id) => !availableIds.has(id)) ?? [])],
    };
    void save(
      scope === "global"
        ? { ...preferences, global: next }
        : { ...preferences, overrides: { ...preferences.overrides, [context.workspaceId]: next } },
    );
  };
  const reset = () => {
    if (scope === "global") void save({ ...preferences, global: { order: [], hidden: [] } });
    else {
      const overrides = { ...preferences.overrides };
      delete overrides[context.workspaceId];
      void save({ ...preferences, overrides });
    }
  };
  const runCommand = (command: WorkspaceCommand | undefined) => {
    if (!command || command.disabled) return;
    setPalette(false);
    command.run();
  };
  const headerContext = { ...context, onCommandPalette: openPalette };
  return (
    <section className="hf-shared-workspace" data-density={compact ? "compact" : "comfortable"}>
      <header className="hf-workspace-header">
        <div className="hf-workspace-header-main">
          <div className="hf-workspace-target">
            <OrgCloud color={org?.color || "#79849b"} />
            <label>
              Target org
              <select
                aria-label="Target Salesforce org"
                title={
                  org
                    ? `${org.label} · ${org.salesforceOrgId} · ${org.username}`
                    : "Choose a connected org"
                }
                value={context.orgId}
                disabled={pinned || context.orgs.length === 0}
                onChange={(event) => context.onOrgChange(event.target.value)}
              >
                <option value="" disabled>
                  Choose a connected org
                </option>
                {context.orgs.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.label} · {orgEnvironment(item)}
                  </option>
                ))}
              </select>
            </label>
            <span className="hf-badge">{org ? orgEnvironment(org) : "No org"}</span>
            {pinned && (
              <span className="hf-badge" title="Saved work retains its original verified org">
                Pinned
              </span>
            )}
          </div>
          <strong className="hf-workspace-title" title={title}>
            {title}
          </strong>
          <button
            className="hf-button hf-compact"
            type="button"
            ref={customizeTrigger}
            disabled={!preferencesReady}
            title={!preferencesReady ? "Reading the saved workspace preferences" : undefined}
            onClick={() => {
              draftFor(preferences.overrides[context.workspaceId] ? "workspace" : "global");
              setError("");
              setCustomize(true);
            }}
          >
            Customize workspace
          </button>
        </div>
        {org && (
          <p className="hf-workspace-target-detail">
            <code>{org.salesforceOrgId}</code>
            <span>{org.alias || org.username}</span>
            <span>{org.status}</span>
            {pinned && <span>Open a new workspace to choose another org.</span>}
          </p>
        )}
        <div className="hf-workspace-controls">
          {resolved
            .filter((control) => control.visible)
            .map((control) => {
              const Component = adminUtilityHeaderComponents[control.componentId];
              return Component ? (
                <div
                  className={`hf-workspace-control hf-workspace-control-${control.placement}`}
                  key={control.id}
                >
                  <Component {...headerContext} />
                </div>
              ) : (
                <span className="hf-muted" key={control.id}>
                  {control.name} unavailable in this build
                </span>
              );
            })}
        </div>
        {!preferencesReady && error && (
          <p className="hf-alert" role="alert">
            {error} Reopen the workspace to retry. Existing preferences have not been overwritten.
          </p>
        )}
      </header>
      <div className={`hf-shared-workspace-body ${native ? "hf-shared-workspace-native" : ""}`}>
        {children}
      </div>
      <dialog
        className="hf-workspace-dialog"
        ref={customizeDialog}
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) setCustomize(false);
        }}
      >
        <div className="hf-card-heading">
          <div>
            <p className="hf-eyebrow">YOUR WORKSPACE, YOUR WAY</p>
            <h2>Customize workspace</h2>
          </div>
          <button
            className="hf-icon-button"
            type="button"
            aria-label="Close workspace customization"
            disabled={busy}
            onClick={() => setCustomize(false)}
          >
            ×
          </button>
        </div>
        <p>
          The target org is always visible. Optional controls can be hidden or reordered without
          changing saved work.
        </p>
        <label className="hf-field">
          Apply preferences to
          <select
            value={scope}
            disabled={busy}
            onChange={(event) => draftFor(event.target.value as "global" | "workspace")}
          >
            <option value="global">Global default for workspaces</option>
            <option value="workspace">Only {title}</option>
          </select>
        </label>
        {scope === "workspace" && !preferences.overrides[context.workspaceId] && (
          <p className="hf-note">
            This workspace currently follows the global default. Save to create an override.
          </p>
        )}
        {error && (
          <p className="hf-alert" role="alert">
            {error}
          </p>
        )}
        <ol className="hf-header-customization">
          {draftControls.map((control, index) => (
            <li key={control.id}>
              <label>
                <input
                  type="checkbox"
                  checked={control.visible}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      hidden: event.target.checked
                        ? value.hidden.filter((id) => id !== control.id)
                        : [...new Set([...value.hidden, control.id])],
                    }))
                  }
                />
                <span>
                  {control.name}
                  <small>
                    {control.placement} · {control.id}
                  </small>
                </span>
              </label>
              <div>
                <button
                  className="hf-button hf-compact"
                  type="button"
                  aria-label={`Move ${control.name} earlier`}
                  disabled={busy || index === 0}
                  onClick={() =>
                    setDraft((value) => ({
                      ...value,
                      order: moveHeaderControl(value.order, control.id, -1),
                    }))
                  }
                >
                  ↑
                </button>
                <button
                  className="hf-button hf-compact"
                  type="button"
                  aria-label={`Move ${control.name} later`}
                  disabled={busy || index === draftControls.length - 1}
                  onClick={() =>
                    setDraft((value) => ({
                      ...value,
                      order: moveHeaderControl(value.order, control.id, 1),
                    }))
                  }
                >
                  ↓
                </button>
              </div>
            </li>
          ))}
        </ol>
        {controls.length === 0 && (
          <p className="hf-note">
            No active extension contributes optional controls to this workspace.
          </p>
        )}
        <div className="hf-workspace-dialog-actions">
          <button className="hf-button" type="button" disabled={busy} onClick={reset}>
            {scope === "global" ? "Reset global defaults" : "Use global defaults"}
          </button>
          <div className="hf-actions">
            <button
              className="hf-button"
              type="button"
              disabled={busy}
              onClick={() => setCustomize(false)}
            >
              Cancel
            </button>
            <button
              className="hf-button hf-primary"
              type="button"
              disabled={busy}
              onClick={saveDraft}
            >
              {busy ? "Saving…" : "Save preferences"}
            </button>
          </div>
        </div>
      </dialog>
      <dialog
        className="hf-workspace-dialog hf-command-dialog"
        ref={paletteDialog}
        onCancel={(event) => {
          event.preventDefault();
          setPalette(false);
        }}
      >
        <div className="hf-card-heading">
          <h2>Search & commands</h2>
          <button
            className="hf-icon-button"
            type="button"
            aria-label="Close command palette"
            onClick={() => setPalette(false)}
          >
            ×
          </button>
        </div>
        <label className="hf-field">
          Find a workspace, org or setup action
          <input
            autoFocus
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPaletteIndex(0);
            }}
            placeholder="Switch to QA, open Setup, inspect a record…"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setPaletteIndex((value) => Math.min(value + 1, Math.max(0, matches.length - 1)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setPaletteIndex((value) => Math.max(0, value - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                runCommand(matches[paletteIndex]);
              }
            }}
          />
        </label>
        <div className="hf-command-results">
          {matches.map((command, index) => (
            <button
              className={`hf-command-result ${index === paletteIndex ? "selected" : ""}`}
              key={command.id}
              type="button"
              disabled={command.disabled}
              title={command.reason}
              onClick={() => runCommand(command)}
            >
              <strong>{command.name}</strong>
              <small>{command.disabled ? command.reason : command.description}</small>
            </button>
          ))}
          {matches.length === 0 && <p className="hf-note">No commands match this search.</p>}
        </div>
        <p className="hf-note">
          ↑ ↓ to choose · Enter to run · Escape to close. Setup actions use the visible target org.
        </p>
      </dialog>
    </section>
  );
}
