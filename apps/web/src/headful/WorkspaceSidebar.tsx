/* oxlint-disable shadcn/no-unknown-classes -- Headful owns the frame layout. */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowLeft, ChevronRight, Search, Settings, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { pageGroups, type SettingsPage } from "./org-settings/settings-navigation";
import { ContributionIcon } from "./admin-workspace/EditorToolMenu";
import { editorStep, type EditorTool } from "./admin-workspace/editor-contributions";

export function WorkspaceSidebar({
  settings,
  page,
  activeTool,
  tools,
  onTool,
  onSettings,
  onHome,
  footer,
  trigger,
  open,
  onClose,
}: {
  settings: boolean;
  page: SettingsPage;
  activeTool: string;
  tools: readonly EditorTool[];
  onTool: (id: string) => void;
  onSettings: (page: SettingsPage) => void;
  onHome: () => void;
  footer: ReactNode;
  trigger: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
}) {
  const [searchState, setSearchState] = useState({ scope: settings, value: "" });
  const search = searchState.scope === settings ? searchState.value : "";
  const setSearch = (value: string) => setSearchState({ scope: settings, value });
  const searchInput = useRef<HTMLInputElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open) searchInput.current?.focus();
  }, [open]);
  const query = search.trim().toLowerCase();
  const groups = pageGroups
    .map((group) => ({
      ...group,
      pages: group.pages.filter((item) =>
        `${group.title} ${item.title} ${item.keywords}`.toLowerCase().includes(query),
      ),
    }))
    .filter((group) => group.pages.length);
  const matches = tools.filter((item) =>
    `${item.contribution.name} ${item.ownerName}`.toLowerCase().includes(query),
  );
  const select = (action: () => void) => {
    action();
    setSearch("");
    onClose();
  };
  return (
    <>
      {open && (
        <button className="sf-sidebar-backdrop" aria-label="Close navigation" onClick={onClose} />
      )}
      <aside
        ref={sidebar}
        id="workspace-navigation"
        className="sf-sidebar"
        data-open={open || undefined}
        aria-label={settings ? "Settings navigation" : "Workspace navigation"}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key === "Tab" && open && window.matchMedia?.("(max-width: 760px)").matches) {
            const controls = [
              ...(sidebar.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled), input, summary",
              ) ?? []),
            ];
            const visibleControls = controls.filter(
              (control) => control.getClientRects().length > 0,
            );
            const first = visibleControls[0],
              last = visibleControls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <label className="sf-navigation-search">
          <Search size={15} aria-hidden="true" />
          <input
            ref={searchInput}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={settings ? "Search settings" : "Find workspace tool"}
            placeholder="Find…"
          />
          {search && (
            <button aria-label="Clear navigation search" onClick={() => setSearch("")}>
              <X size={12} />
            </button>
          )}
        </label>
        <nav
          className="sf-navigation-items"
          aria-label={settings ? "Settings sections" : "Admin tools"}
        >
          {settings ? (
            <>
              <div className="sf-navigation-back">
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="settings-home"
                  onClick={() => select(onHome)}
                >
                  <ArrowLeft size={15} /> <span>Workspace</span>
                </Button>
                <span>Settings</span>
              </div>
              {groups.map((group) => (
                <div className="sf-navigation-group" key={group.title}>
                  <span className="sf-navigation-caption">{group.title}</span>
                  {group.pages.map((item) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      key={item.id}
                      data-testid={`org-settings-${item.id}`}
                      aria-current={page === item.id ? "page" : undefined}
                      onClick={() => select(() => onSettings(item.id))}
                    >
                      <span>{item.title}</span>
                    </Button>
                  ))}
                </div>
              ))}
              {!groups.length && (
                <p className="sf-navigation-empty" role="status">
                  No settings match.
                </p>
              )}
            </>
          ) : (
            <>
              {matches.map((item) => (
                <Button
                  variant="ghost"
                  size="sm"
                  key={item.key}
                  data-testid={`admin-tool-${editorStep(item.contribution.id, item.contribution.componentId)}`}
                  aria-current={
                    activeTool === editorStep(item.contribution.id, item.contribution.componentId)
                      ? "page"
                      : undefined
                  }
                  disabled={!item.available}
                  title={item.available ? undefined : (item.unavailableReason ?? undefined)}
                  onClick={() =>
                    select(() =>
                      onTool(editorStep(item.contribution.id, item.contribution.componentId)),
                    )
                  }
                >
                  <ContributionIcon name={item.contribution.icon} />{" "}
                  <span>{item.contribution.name}</span>
                </Button>
              ))}
              {!matches.length && (
                <p className="sf-navigation-empty" role="status">
                  No tools match.
                </p>
              )}
              <div className="sf-navigation-divider" />
              <Button
                ref={trigger}
                variant="ghost"
                size="sm"
                aria-label="Settings"
                onClick={() => select(() => onSettings(page))}
              >
                <Settings size={15} /> <span>Settings</span> <ChevronRight size={14} />
              </Button>
            </>
          )}
        </nav>
        <div className="sf-sidebar-footer">{footer}</div>
      </aside>
    </>
  );
}
