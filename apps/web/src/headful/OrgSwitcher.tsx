/* oxlint-disable shadcn/no-unknown-classes -- Focused Headful surface uses its scoped stylesheet. */
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ExternalLink, Plus, Search } from "lucide-react";

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
      onToggle={(event) => {
        if (!event.currentTarget.open) setSearch("");
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menu.current?.open) {
          event.preventDefault();
          close();
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
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <section className="sf-org-picker" aria-label="Salesforce orgs">
        <label className="sf-org-search">
          <Search size={14} aria-hidden="true" />
          <input
            aria-label="Find an org or login"
            placeholder="Find an org or login…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
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
                        <div className="sf-org-picker-identity">
                          <strong>{org.label}</strong>
                          <span>{org.username}</span>
                          <small>
                            {org.environment} · {org.salesforceOrgId}
                            {!org.available && ` · ${org.reason}`}
                          </small>
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
              {orgs.length ? "No orgs match your search." : "No connected orgs yet."}
            </p>
          )}
        </div>
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
