import { lazy, memo, useRef, useState, type ComponentType } from "react";
export { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
export { DocumentView } from "./DocumentView";
export { PanelTabs, panelTabId } from "./PanelTabs";
import type { UtilityComponentProps } from "./types";
export { OrgCloud } from "./OrgShortcuts";
export type { UtilityComponentProps, UtilityOrg } from "./types";
export { orgEnvironment } from "./types";
export { LazySurface } from "./LazySurface";

function registered(load: () => Promise<{ default: ComponentType<UtilityComponentProps> }>) {
  let pending: ReturnType<typeof load> | undefined;
  const preload = () => (pending ??= load());
  return { Component: memo(lazy(preload)), preload };
}
const tools = {
  "headful.admin-utilities/backup-recovery": registered(() =>
    import("./BackupRecovery").then((m) => ({ default: m.BackupRecovery })),
  ),
  "headful.admin-utilities/org-shortcuts": registered(() =>
    import("./OrgShortcuts").then((m) => ({ default: m.OrgShortcuts })),
  ),
  "headful.admin-utilities/record-inspector": registered(() =>
    import("./RecordInspector").then((m) => ({ default: m.RecordInspector })),
  ),
  "headful.admin-utilities/soql-workspace": registered(() =>
    import("./SoqlWorkspace").then((m) => ({ default: m.SoqlWorkspace })),
  ),
  "headful.admin-utilities/schema-explorer": registered(() =>
    import("./SchemaExplorer").then((m) => ({ default: m.SchemaExplorer })),
  ),
  "headful.admin-utilities/diagnostics": registered(() =>
    import("./Diagnostics").then((m) => ({ default: m.Diagnostics })),
  ),
};

/** Intent may warm host code, but never triggers an org read or activates a mod. */
export function preloadAdminUtility(id: string) {
  return tools[id as keyof typeof tools]?.preload();
}
const FavoriteLinks = lazy(() =>
  import("./OrgShortcuts").then((m) => ({ default: m.FavoriteLinks })),
);
const SavedQueriesControl = lazy(() =>
  import("./SoqlWorkspace").then((m) => ({ default: m.SavedQueriesControl })),
);

function SearchControl(props: UtilityComponentProps) {
  return (
    <button className="hf-button hf-compact" type="button" onClick={props.onCommandPalette}>
      Workspace commands <kbd>⌘⇧K</kbd>
    </button>
  );
}
function StatusControl(props: UtilityComponentProps) {
  const org = props.orgs.find((item) => item.id === props.orgId);
  return (
    <span
      className={`hf-badge ${org?.status === "connected" ? "hf-good" : ""}`}
      aria-label={`Selected connection: ${org?.status || "No connection"}`}
    >
      {org?.status || "No connection"}
    </span>
  );
}
function ActionsControl(props: UtilityComponentProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const actions = props.actionContributions ?? [];
  if (actions.length === 0) return null;
  return (
    <div className="hf-utility-popover">
      <button
        className="hf-button hf-compact"
        ref={trigger}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Org actions ▾
      </button>
      {open && (
        <div
          className="hf-utility-popover-body"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          {actions.map((action) => (
            <button
              className="hf-utility-link"
              type="button"
              key={action.id}
              disabled={action.disabled}
              onClick={() => {
                setOpen(false);
                action.run();
                trigger.current?.focus();
              }}
            >
              {action.name}
              {action.reason && <small>{action.reason}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Registered React components are resolved from reviewed manifest references, never mod DOM hooks. */
export const adminUtilityComponents: Readonly<
  Record<string, ComponentType<UtilityComponentProps>>
> = Object.fromEntries(Object.entries(tools).map(([id, tool]) => [id, tool.Component]));
export const adminUtilityHeaderComponents: Readonly<
  Record<string, ComponentType<UtilityComponentProps>>
> = {
  "headful.admin-utilities/search": SearchControl,
  "headful.admin-utilities/favorites": FavoriteLinks,
  "headful.admin-utilities/status": StatusControl,
  "headful.admin-utilities/actions": ActionsControl,
  "headful.admin-utilities/secondary": SavedQueriesControl,
};
