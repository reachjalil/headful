import { useRef, useState, type ComponentType } from "react";
import { OrgShortcuts, FavoriteLinks } from "./OrgShortcuts";
import { RecordInspector } from "./RecordInspector";
import { SoqlWorkspace, SavedQueriesControl } from "./SoqlWorkspace";
import { SchemaExplorer } from "./SchemaExplorer";
import { Diagnostics } from "./Diagnostics";
import type { UtilityComponentProps } from "./types";
export { OrgCloud } from "./OrgShortcuts";
export type { UtilityComponentProps, UtilityOrg } from "./types";
export { orgEnvironment } from "./types";

function SearchControl(props: UtilityComponentProps) {
  return (
    <button className="hf-button hf-compact" type="button" onClick={props.onCommandPalette}>
      Search & commands <kbd>⌘K</kbd>
    </button>
  );
}
function StatusControl(props: UtilityComponentProps) {
  const org = props.orgs.find((item) => item.id === props.orgId);
  return (
    <span
      className={`hf-badge ${org?.status === "connected" ? "hf-good" : ""}`}
      title="Status of this selected connection"
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
              title={action.reason}
              onClick={() => {
                setOpen(false);
                action.run();
                trigger.current?.focus();
              }}
            >
              {action.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Registered React components are resolved from reviewed manifest references, never extension DOM hooks. */
export const adminUtilityComponents: Readonly<
  Record<string, ComponentType<UtilityComponentProps>>
> = {
  "admin-utilities/org-shortcuts": OrgShortcuts,
  "admin-utilities/record-inspector": RecordInspector,
  "admin-utilities/soql-workspace": SoqlWorkspace,
  "admin-utilities/schema-explorer": SchemaExplorer,
  "admin-utilities/diagnostics": Diagnostics,
};
export const adminUtilityHeaderComponents: Readonly<
  Record<string, ComponentType<UtilityComponentProps>>
> = {
  "admin-utilities/search": SearchControl,
  "admin-utilities/favorites": FavoriteLinks,
  "admin-utilities/status": StatusControl,
  "admin-utilities/actions": ActionsControl,
  "admin-utilities/secondary": SavedQueriesControl,
};
