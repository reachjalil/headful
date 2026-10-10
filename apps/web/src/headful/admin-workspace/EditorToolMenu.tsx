/* oxlint-disable shadcn/no-unknown-classes -- Headful editor uses a scoped compact toolbar. */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Activity,
  Cloud,
  Database,
  ExternalLink,
  Key,
  Search,
  Star,
  Table2,
  Users,
  Puzzle,
  ChevronDown,
} from "lucide-react";
import type { EditorAction, EditorTool } from "./editor-contributions";

const icons = {
  cloud: Cloud,
  search: Search,
  table: Table2,
  database: Database,
  activity: Activity,
  "external-link": ExternalLink,
  star: Star,
  key: Key,
  users: Users,
};
export function ContributionIcon({ name }: { name: keyof typeof icons }) {
  const Icon = icons[name];
  return <Icon size={15} aria-hidden="true" />;
}
export function EditorToolMenu({
  tools,
  actions,
  activeId,
  pending,
  onTool,
  onAction,
  onManageMods,
  onPreload,
}: {
  tools: readonly EditorTool[];
  actions: readonly EditorAction[];
  activeId: string;
  pending: boolean;
  onTool: (id: string) => void;
  onAction: (action: EditorAction) => void;
  onManageMods?: (() => void) | undefined;
  onPreload?: ((tool: EditorTool) => void) | undefined;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const close = useCallback(() => {
    menu.current?.removeAttribute("open");
    setSearch("");
    menu.current?.querySelector("summary")?.focus();
  }, []);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target))
        menu.current?.removeAttribute("open");
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !menu.current ||
        menu.current.closest("[hidden]")
      )
        return;
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        menu.current.open = true;
        searchInput.current?.focus();
        return;
      }
      if (event.key === "Escape" && menu.current?.open) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", escape);
    };
  }, [close]);
  if (!tools.length && !actions.length && !onManageMods) return null;
  const term = search.trim().toLowerCase();
  const matches = (...terms: (string | undefined)[]) =>
    terms.join(" ").toLowerCase().includes(term);
  const filtered = tools.filter((tool) =>
    matches(tool.contribution.name, tool.ownerName, tool.contribution.componentId),
  );
  const filteredActions = actions.filter((action) =>
    matches(
      action.contribution.name,
      action.ownerName,
      action.command.name,
      action.command.description,
    ),
  );
  const move = (event: ReactKeyboardEvent<HTMLDetailsElement>) => {
    if (
      event.isDefaultPrevented() ||
      event.nativeEvent.isComposing ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey ||
      !menu.current?.open
    )
      return;
    const buttons = [
      ...menu.current.querySelectorAll<HTMLButtonElement>("[data-editor-result]:not(:disabled)"),
    ];
    if (event.target === searchInput.current && event.key === "Enter") {
      event.preventDefault();
      buttons[0]?.click();
      return;
    }
    const fromSearch = event.target === searchInput.current;
    if (
      !["ArrowDown", "ArrowUp"].includes(event.key) &&
      (fromSearch || !["Home", "End"].includes(event.key))
    )
      return;
    event.preventDefault();
    const items = searchInput.current ? [searchInput.current, ...buttons] : buttons;
    const index = items.indexOf(event.target as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <details
      className="sf-editor-menu"
      ref={menu}
      onKeyDown={move}
      onToggle={() => {
        if (menu.current?.open) searchInput.current?.focus();
        else setSearch("");
      }}
    >
      <summary data-testid="editor-tools-menu" aria-keyshortcuts="Meta+K Control+K">
        <Puzzle size={15} aria-hidden="true" /> Tools <kbd aria-hidden="true">⌘K</kbd>{" "}
        <ChevronDown size={12} aria-hidden="true" />
      </summary>
      <div className="sf-editor-menu-body">
        <label className="sf-editor-tool-search">
          Find tools and actions
          <input
            type="search"
            ref={searchInput}
            data-testid="editor-tools-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={100}
          />
        </label>
        {filtered.length > 0 && (
          <>
            <p className="sf-editor-menu-label">Tools</p>
            <div className="sf-editor-menu-tools" aria-label="Matching tools">
              {filtered.map((tool) => (
                <button
                  key={tool.key}
                  data-testid={`editor-tool-${tool.contribution.id}`}
                  data-editor-result="true"
                  disabled={!tool.available}
                  onPointerEnter={() => onPreload?.(tool)}
                  onFocus={() => onPreload?.(tool)}
                  aria-current={tool.contribution.id === activeId ? "page" : undefined}
                  onClick={() => {
                    close();
                    onTool(tool.contribution.id);
                  }}
                >
                  <ContributionIcon name={tool.contribution.icon} />
                  <span>
                    {tool.contribution.name}
                    <small>
                      {tool.ownerName}
                      {tool.unavailableReason && ` · ${tool.unavailableReason}`}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        {filteredActions.length > 0 && (
          <div className="sf-editor-menu-actions" aria-label="Actions for this tool">
            <p>Actions for this tool</p>
            {filteredActions.map((action) => (
              <button
                key={`${action.modId}:${action.revision}:${action.contribution.id}`}
                data-testid={`editor-menu-action-${action.contribution.id}`}
                data-editor-result="true"
                disabled={pending || !action.available}
                onClick={() => {
                  close();
                  onAction(action);
                }}
              >
                <ContributionIcon name={action.contribution.icon} />
                <span>
                  {action.contribution.name}
                  <small>
                    {action.unavailableReason ??
                      (pending
                        ? "Wait for the current request"
                        : action.needsConfiguration
                          ? "Configure in Local mods"
                          : action.ownerName)}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )}
        {!filtered.length && !filteredActions.length && (
          <p className="sf-editor-menu-label" role="status">
            No matching tools or actions.
          </p>
        )}
        {onManageMods && (
          <button
            className="sf-editor-manage-mods"
            data-testid="editor-manage-mods"
            onClick={() => {
              close();
              onManageMods();
            }}
          >
            Manage local mods
          </button>
        )}
      </div>
    </details>
  );
}
