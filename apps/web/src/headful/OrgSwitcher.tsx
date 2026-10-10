/* oxlint-disable shadcn/no-unknown-classes -- Focused Headful surface uses its scoped stylesheet. */
import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, ExternalLink, Plus, Search, X } from "lucide-react";

export interface OrgSwitchOption {
  id: string;
  label: string;
  username: string;
  salesforceOrgId: string;
  environment: string;
  available: boolean;
  reason: string;
}

/** Navigation selects an exact existing connection; it never enables org authority. */
export function OrgSwitcher({
  orgs,
  selectedId,
  onSelect,
  onManage,
  onOpen,
  openDisabled = false,
}: {
  orgs: OrgSwitchOption[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onManage: () => void;
  onOpen?: (() => void) | undefined;
  openDisabled?: boolean | undefined;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const selected = orgs.find((org) => org.id === selectedId);
  const visible = orgs.filter((org) =>
    `${org.label} ${org.username} ${org.salesforceOrgId} ${org.environment}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const close = () => {
    if (menu.current) {
      menu.current.open = false;
      menu.current.querySelector("summary")?.focus();
    }
    setSearch("");
  };
  const focusOption = (direction: number, edge?: "first" | "last") => {
    const options = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>(".sf-org-picker-list button") ?? []),
    ];
    if (!options.length) return;
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      edge === "first"
        ? 0
        : edge === "last"
          ? options.length - 1
          : current < 0
            ? direction > 0
              ? 0
              : options.length - 1
            : (current + direction + options.length) % options.length;
    options[next]?.focus();
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menu]);
  return (
    <details
      ref={menu}
      className="sf-org-switcher"
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) {
          event.currentTarget.open = false;
          setSearch("");
        }
      }}
      onToggle={(event) => {
        if (event.target !== event.currentTarget) return;
        if (!event.currentTarget.open) setSearch("");
        else searchInput.current?.focus();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menu.current?.open) {
          event.preventDefault();
          close();
        }
        if (
          menu.current?.open &&
          ["ArrowDown", "ArrowUp"].includes(event.key) &&
          (event.target === searchInput.current ||
            (event.target as HTMLElement).closest(".sf-org-picker-list"))
        ) {
          event.preventDefault();
          focusOption(event.key === "ArrowDown" ? 1 : -1);
        }
        if (
          menu.current?.open &&
          ["Home", "End"].includes(event.key) &&
          (event.target as HTMLElement).closest(".sf-org-picker-list")
        ) {
          event.preventDefault();
          focusOption(0, event.key === "Home" ? "first" : "last");
        }
      }}
    >
      <summary
        data-testid="org-switcher"
        aria-label={`Switch Salesforce org${selected ? `: ${selected.label}, ${selected.username}, ${selected.environment}` : ""}`}
      >
        <div className="sf-org-switcher-identity">
          <strong>{selected?.label ?? "Select an org"}</strong>
          <span>{selected?.username ?? "Manage your connections"}</span>
        </div>
        {selected && <span className="sf-org-environment">{selected.environment}</span>}
        <ChevronsUpDown size={14} aria-hidden="true" />
      </summary>
      <section className="sf-org-picker" aria-label="Salesforce orgs">
        <div className="sf-org-picker-heading">Switch org</div>
        <label className="sf-org-search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchInput}
            aria-label="Find an org or login"
            placeholder="Find an org or login…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              type="button"
              className="sf-org-search-clear"
              aria-label="Clear org search"
              onClick={() => {
                setSearch("");
                searchInput.current?.focus();
              }}
            >
              <X size={13} />
            </button>
          )}
        </label>
        <div className="sf-org-picker-list">
          {[true, false].map((available) => {
            const group = visible.filter((org) => org.available === available);
            if (!group.length) return null;
            return (
              <div className="sf-org-picker-group" key={String(available)}>
                <h2>{available ? "Available orgs" : "Other connections"}</h2>
                <ul>
                  {group.map((org) => (
                    <li key={org.id}>
                      <button
                        type="button"
                        data-testid={`workspace-org-${org.id}`}
                        aria-current={selectedId === org.id ? "true" : undefined}
                        onClick={() => {
                          close();
                          if (org.available) onSelect(org.id);
                          else onManage();
                        }}
                      >
                        <span className="sf-org-option-mark" aria-hidden="true">
                          {org.label.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="sf-org-picker-identity">
                          <div className="sf-org-option-heading">
                            <strong>{org.label}</strong>
                            <span className="sf-org-option-environment">{org.environment}</span>
                          </div>
                          <span>{org.username}</span>
                          {!org.available && (
                            <small className="sf-org-attention">{org.reason}</small>
                          )}
                        </div>
                        {selectedId === org.id ? (
                          <Check size={15} aria-label="Selected org" />
                        ) : !org.available ? (
                          <span className="sf-org-review">Manage</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {!visible.length && (
            <p className="sf-org-picker-empty" role="status">
              {orgs.length ? `No orgs match “${search.trim()}”.` : "No connected orgs yet."}
            </p>
          )}
        </div>
        {selected && (
          <details className="sf-org-picker-context">
            <summary>Connection details</summary>
            <dl>
              <div>
                <dt>Signed in as</dt>
                <dd>{selected.username}</dd>
              </div>
              <div>
                <dt>Org ID</dt>
                <dd>
                  <code>{selected.salesforceOrgId}</code>
                </dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd>{selected.environment}</dd>
              </div>
            </dl>
          </details>
        )}
        <div className="sf-org-picker-actions">
          {selected && onOpen && (
            <button
              type="button"
              className="sf-org-manage"
              aria-label="Open Salesforce"
              disabled={openDisabled}
              onClick={() => {
                close();
                onOpen();
              }}
            >
              <ExternalLink size={14} aria-hidden="true" /> Open Salesforce
            </button>
          )}
          <button
            type="button"
            className="sf-org-manage"
            data-testid="org-switcher-manage"
            onClick={() => {
              close();
              onManage();
            }}
          >
            <Plus size={14} aria-hidden="true" /> Manage orgs
          </button>
        </div>
      </section>
    </details>
  );
}
