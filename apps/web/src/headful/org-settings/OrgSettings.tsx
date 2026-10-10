/* oxlint-disable shadcn/no-unknown-classes -- Org settings owns its scoped Headful surface. */
import "../workspace-theme.css";
import { AppearanceSettings } from "../Appearance";
import { SetupGuide } from "../SetupGuide";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Boxes,
  Clock,
  Database,
  ExternalLink,
  Info,
  Layers,
  Plug,
  Search,
} from "lucide-react";
import { HEADFUL_SALESFORCE_API_VERSION, type HeadfulResult } from "@t3tools/contracts/headful";
import type { SetupDispatch } from "../setup-service";
import "./org-settings.css";

type Org = HeadfulResult<"orgs.list">["orgs"][number];
import { HeadfulMods } from "../HeadfulMods";
import type { HeadfulModDescriptor } from "@t3tools/contracts/headful-mods";
import { ReadBusy, ReadFrame, useRead } from "./read";
import { SettingsDisclosure, SettingsDisclosureScope } from "./SettingsDisclosure";
import { Licenses } from "./Licenses";
import { limitCategories, limitInfo, type LimitCategory } from "./limit-info";
import { pageGroups, type SettingsPage } from "./settings-navigation";
export { settingsPageTitles, type SettingsPage } from "./settings-navigation";

export function dateLabel(value: string | null) {
  if (!value) return "Not reported";
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (!Number.isFinite(parsed.getTime())) return "Not reported";
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(value.length === 10 ? { timeZone: "UTC" } : {}),
  });
}
export function expiryLabel(value: string | null, now = Date.now()) {
  if (!value) return "Expiry not reported by CLI";
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return "Expiry not reported by CLI";
  const days = Math.ceil((at - now) / 86400000);
  if (value.length === 10) {
    const today = new Date(now).toISOString().slice(0, 10);
    if (value === today) return "Expires today";
  }
  return days <= 0 ? "Expired" : days === 1 ? "Expires within 1 day" : `Expires in ${days} days`;
}
const humanName = (name: string) =>
  name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
const count = (value: number) => value.toLocaleString();
export const retrieveCommand = (username: string, type: string, name: string) => {
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  return `sf project retrieve start --metadata ${quote(`${type}:${name}`)} --target-org ${quote(username)} --api-version ${HEADFUL_SALESFORCE_API_VERSION}`;
};
export function limitUsage(limit: { max: number; remaining: number }) {
  return limit.max > 0
    ? Math.min(100, Math.max(0, ((limit.max - limit.remaining) / limit.max) * 100))
    : null;
}

function Expiry({ overview }: { overview: HeadfulResult<"orgs.overview"> }) {
  if (overview.environment !== "scratch") return null;
  return (
    <div className="os-notice os-warning">
      <Clock size={20} />
      <div>
        <strong>{expiryLabel(overview.expirationDate)}</strong>
        <p>
          {dateLabel(overview.expirationDate)}
          {overview.expirationDate
            ? " · Keep the metadata you need in your project before this org expires."
            : " · Salesforce CLI has not reported an expiry for this login."}
        </p>
      </div>
    </div>
  );
}

function Overview({
  org,
  dispatch,
  navigate,
}: {
  org: Org;
  dispatch: SetupDispatch;
  navigate: (page: SettingsPage) => void;
}) {
  const read = useRead(dispatch, "orgs.overview", { orgId: org.id });
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState(false);
  return (
    <ReadFrame
      title="Org overview"
      description="Identity and connection details for this login."
      read={read}
      source="Salesforce Organization + CLI org discovery"
    >
      {read.data && (
        <>
          <Expiry overview={read.data} />
          {!read.data.detailsAvailable && (
            <div className="os-notice os-warning">
              <Info size={18} />
              <p>
                CLI lifecycle information is available, but Salesforce could not return current org
                details. This can happen after expiry or when the login needs reconnecting.
              </p>
            </div>
          )}
          <div className="os-overview-card">
            <div className="os-org-card">
              <div className="os-org-mark">
                <Database size={26} />
              </div>
              <div>
                <span className="os-tag">{humanName(read.data.environment)}</span>
                <h3>{org.organizationName || org.label}</h3>
              </div>
              <button
                className="os-refresh"
                disabled={opening}
                onClick={() => {
                  setOpening(true);
                  setOpenError(false);
                  void dispatch("orgs.open", { orgId: org.id })
                    .catch(() => setOpenError(true))
                    .finally(() => setOpening(false));
                }}
              >
                <ExternalLink size={14} /> Open org
              </button>
            </div>
            {openError && (
              <p role="alert">Salesforce could not open this org. Check the CLI login.</p>
            )}
            <section className="os-section" aria-label="Organization">
              <dl className="os-facts">
                {[
                  ["Edition", read.data.edition],
                  ["Instance", read.data.instance],
                  ["Connected as", org.username],
                  ["Connection", humanName(org.status)],
                  [
                    "Agent access",
                    org.agentEnabled ? "Enabled for this login" : "Disabled for this login",
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value || "Not reported"}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <SettingsDisclosure
              id="connection-identity"
              title="Connection details"
              hint="Org ID, alias and namespace"
            >
              <dl className="os-facts">
                {[
                  ["Org ID", org.salesforceOrgId],
                  ["CLI alias", org.alias || "No alias"],
                  ["Namespace", read.data.namespace || "No namespace"],
                  ["Salesforce URL", org.instanceOrigin],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </SettingsDisclosure>
          </div>
          {read.data.trialExpirationDate && (
            <div className="os-notice">
              <Clock size={18} />
              <p>Trial expires {dateLabel(read.data.trialExpirationDate)}.</p>
            </div>
          )}
          <div className="os-next">
            <button onClick={() => navigate("limits")}>
              <Activity size={20} />
              <div>
                <strong>Licenses & usage</strong>
                <span>Licenses, API, storage and automation capacity</span>
              </div>
              <ArrowRight size={17} />
            </button>
            <button onClick={() => navigate("metadata")}>
              <Boxes size={20} />
              <div>
                <strong>Browse metadata</strong>
                <span>Objects, fields, Apex, flows and more</span>
              </div>
              <ArrowRight size={17} />
            </button>
          </div>
        </>
      )}
    </ReadFrame>
  );
}

function LicensingUsage({
  org,
  dispatch,
  onDetailChange,
}: {
  org: Org;
  dispatch: SetupDispatch;
  onDetailChange?: ((detail: string | null) => void) | undefined;
}) {
  const [view, setView] = useState<"licenses" | "limits">("licenses");
  useEffect(() => {
    onDetailChange?.(view === "licenses" ? "Licenses" : "Org limits");
  }, [view, onDetailChange]);
  return (
    <>
      <div className="os-switch" aria-label="Licenses and usage views">
        <button
          data-testid="org-settings-usage-licenses"
          aria-pressed={view === "licenses"}
          onClick={() => setView("licenses")}
        >
          Licenses
        </button>
        <button
          data-testid="org-settings-usage-limits"
          aria-pressed={view === "limits"}
          onClick={() => setView("limits")}
        >
          Org limits
        </button>
      </div>
      {view === "licenses" ? (
        <Licenses orgId={org.id} dispatch={dispatch} />
      ) : (
        <Limits org={org} dispatch={dispatch} />
      )}
    </>
  );
}

function Limits({ org, dispatch }: { org: Org; dispatch: SetupDispatch }) {
  const read = useRead(dispatch, "orgs.limits", { orgId: org.id });
  const [search, setSearch] = useState("");
  const [attention, setAttention] = useState(false);
  const [category, setCategory] = useState<LimitCategory>("All limits");
  const limits = [...(read.data?.limits ?? [])].sort(
    (a, b) => (limitUsage(b) ?? -1) - (limitUsage(a) ?? -1) || a.name.localeCompare(b.name),
  );
  const filtered = limits.filter(
    (l) =>
      `${humanName(l.name)} ${l.name}`.toLowerCase().includes(search.toLowerCase()) &&
      (category === "All limits" || limitInfo(l.name).category === category) &&
      (!attention || (limitUsage(l) ?? 0) >= 80),
  );
  const tight = limits.filter((l) => (limitUsage(l) ?? 0) >= 80).length;
  return (
    <ReadFrame
      title="Org limits & usage"
      description="Shared capacity for this org, across its users and integrations."
      read={read}
      source="Salesforce CLI · org list limits"
    >
      {read.data && (
        <>
          <div className="os-metrics">
            {["DailyApiRequests", "DataStorageMB", "FileStorageMB", "DailyAsyncApexExecutions"].map(
              (name) => {
                const l = limits.find((item) => item.name === name);
                const usage = l ? limitUsage(l) : null;
                return (
                  <div key={name}>
                    <span>{humanName(name)}</span>
                    <strong>{l ? count(l.remaining) : "—"}</strong>
                    <small>
                      {l ? `${limitInfo(name).unit} remaining of ${count(l.max)}` : "Not reported"}
                    </small>
                    <progress max={100} value={usage ?? 0} aria-label={`${humanName(name)} used`} />
                    <small>{limitInfo(name).window}</small>
                  </div>
                );
              },
            )}
          </div>
          <div className="os-tools">
            <label className="os-search">
              <Search size={16} />
              <input
                data-testid="org-settings-limit-search"
                aria-label="Search limits"
                placeholder="Search limits…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button
              aria-pressed={attention}
              className={attention ? "selected" : ""}
              onClick={() => setAttention((v) => !v)}
            >
              Needs attention <span>{tight}</span>
            </button>
          </div>
          <label className="os-limit-category">
            Category
            <select
              aria-label="Limit category"
              data-testid="org-settings-limit-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as LimitCategory)}
            >
              {limitCategories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <SettingsDisclosure
            id="usage-guide"
            title="How usage is reported"
            hint="Attention at 80% used"
          >
            <p>
              Attention starts at 80% used. This is a current snapshot; it does not show a usage
              trend or predict resets.
            </p>
          </SettingsDisclosure>
          <div className="os-limit-list">
            {filtered.map((l) => {
              const usage = limitUsage(l);
              return (
                <div className="os-limit" key={l.name}>
                  <div>
                    <strong>{humanName(l.name)}</strong>
                    {usage !== null && usage >= 80 && (
                      <span className="os-tag os-review-tag">Needs attention</span>
                    )}
                    <SettingsDisclosure id={`limit-${l.name}`} title="Details">
                      <code>{l.name}</code>
                      <p>{limitInfo(l.name).description}</p>
                      <p className="os-limit-window">
                        {limitInfo(l.name).category} · {limitInfo(l.name).window}
                      </p>
                    </SettingsDisclosure>
                  </div>
                  <div>
                    <strong>
                      {count(l.remaining)} <small>{limitInfo(l.name).unit} remaining</small>
                    </strong>
                    <progress
                      className={usage !== null && usage >= 80 ? "warning" : ""}
                      max={100}
                      value={usage ?? 0}
                      aria-label={`${l.name} used`}
                    />
                    <span>
                      {usage === null
                        ? "No allocated capacity reported"
                        : `${Math.round(usage)}% used`}{" "}
                      ·{" "}
                      {l.remaining > l.max
                        ? "Reported remaining exceeds allowance"
                        : `${count(l.max - l.remaining)} of ${count(l.max)} ${limitInfo(l.name).unit} used`}
                    </span>
                  </div>
                </div>
              );
            })}
            {!filtered.length && (
              <div className="os-empty">
                {limits.length
                  ? "No limits match this filter."
                  : "Salesforce did not report any limits."}
              </div>
            )}
          </div>
        </>
      )}
    </ReadFrame>
  );
}

function Components({
  org,
  type,
  dispatch,
  folder,
}: {
  org: Org;
  type: HeadfulResult<"orgs.metadata">["types"][number];
  dispatch: SetupDispatch;
  folder?: string | undefined;
}) {
  const read = useRead(dispatch, "orgs.metadata.components", {
    orgId: org.id,
    type: type.name,
    ...(folder ? { folder } : {}),
  });
  const [search, setSearch] = useState("");
  const components =
    read.data?.components.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())) ?? [];
  return (
    <ReadFrame
      title={type.name}
      description={`Project directory: ${type.directory}${type.suffix ? ` · .${type.suffix}` : ""}`}
      read={read}
      source="Salesforce CLI · org list metadata"
    >
      {read.data && (
        <>
          <label className="os-search">
            <Search size={15} />
            <input
              data-testid="org-settings-component-search"
              aria-label="Search components"
              placeholder="Search components…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <p className="os-small">
            {read.data.components.length} components
            {read.data.capped ? " · Showing the first 500" : ""}
            {read.data.folder ? ` · Folder: ${read.data.folder}` : ""}
          </p>
          <p className="os-small">
            Discovery can omit components. An empty list does not prove that a component is absent
            or editable.
          </p>
          <div className="os-components">
            {components.map((c) => (
              <div key={c.name}>
                <strong>{c.name}</strong>
                <span>
                  {c.namespace ? `Package: ${c.namespace}` : "Org metadata"}
                  {c.manageableState ? ` · ${humanName(c.manageableState)}` : ""}
                </span>
                <p>
                  Changed {dateLabel(c.modifiedAt)}
                  {c.modifiedBy ? ` by ${c.modifiedBy}` : ""}
                </p>
                <details className="os-command">
                  <summary>Use in your project</summary>
                  <p>
                    Run from your Salesforce DX project to retrieve this component’s source. Review
                    local changes before retrieving.
                  </p>
                  <code>{retrieveCommand(org.username, type.name, c.name)}</code>
                </details>
              </div>
            ))}
          </div>
          {!components.length && (
            <div className="os-empty">
              {read.data.components.length
                ? "No components match this search."
                : "No components were returned for this metadata type."}
            </div>
          )}
        </>
      )}
    </ReadFrame>
  );
}

function FolderComponents({
  org,
  type,
  dispatch,
}: {
  org: Org;
  type: HeadfulResult<"orgs.metadata">["types"][number];
  dispatch: SetupDispatch;
}) {
  const [draft, setDraft] = useState("");
  const [folder, setFolder] = useState("");
  return (
    <>
      <form
        className="os-folder"
        onSubmit={(e) => {
          e.preventDefault();
          setFolder(draft.trim());
        }}
      >
        <label>
          Folder API name
          <input
            aria-label="Folder API name"
            required
            maxLength={200}

            placeholder="e.g. unfiled$public"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <button type="submit">Browse folder</button>
      </form>
      {folder ? (
        <Components key={folder} org={org} type={type} dispatch={dispatch} folder={folder} />
      ) : (
        <div className="os-empty">
          <strong>{type.name} uses folders</strong>
          <p>Enter a folder API name from Salesforce to list its components.</p>
        </div>
      )}
    </>
  );
}

function Metadata({
  org,
  dispatch,
  onDetailChange,
}: {
  org: Org;
  dispatch: SetupDispatch;
  onDetailChange?: ((detail: string | null) => void) | undefined;
}) {
  const read = useRead(dispatch, "orgs.metadata", { orgId: org.id });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    onDetailChange?.(selected || null);
  }, [selected, onDetailChange]);
  const types =
    read.data?.types.filter((t) => t.name.toLowerCase().includes(search.toLowerCase())) ?? [];
  const type = read.data?.types.find((t) => t.name === selected);
  return (
    <ReadFrame
      title="Metadata explorer"
      description="Understand the building blocks in this org. Browse a type to see its components."
      read={read}
      source="Salesforce CLI · org list metadata-types"
    >
      {read.data && (
        <>
          <div className="os-notice">
            <Boxes size={18} />
            <p>
              Metadata defines how your org works: objects, fields, layouts, Apex and automation.
              Keep project source before changing or replacing an environment.
            </p>
          </div>
          <div className="os-metadata">
            <aside>
              <label className="os-search">
                <Search size={15} />
                <input
                  aria-label="Search metadata types"
                  placeholder="Find a metadata type…"
                  data-testid="org-settings-type-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <p className="os-small">
                {types.length} of {read.data.types.length} types
              </p>
              <div>
                {types.map((t) => (
                  <button
                    key={t.name}
                    data-testid={`org-settings-type-${t.name.toLowerCase()}`}
                    aria-pressed={selected === t.name}
                    onClick={() => setSelected(t.name)}
                  >
                    <span>{t.name}</span>
                    <ArrowRight size={13} />
                  </button>
                ))}
              </div>
              {!types.length && <p>No metadata types match.</p>}
            </aside>
            <section>
              {!type ? (
                <div className="os-empty">
                  <Boxes size={30} />
                  <strong>Choose a metadata type</strong>
                  <p>Try CustomObject, ApexClass, Flow or PermissionSet.</p>
                </div>
              ) : type.inFolder ? (
                <FolderComponents key={type.name} org={org} type={type} dispatch={dispatch} />
              ) : (
                <Components key={type.name} org={org} type={type} dispatch={dispatch} />
              )}
            </section>
          </div>
        </>
      )}
    </ReadFrame>
  );
}

function SandboxInventory({ org, dispatch }: { org: Org; dispatch: SetupDispatch }) {
  const read = useRead(dispatch, "orgs.environments", { orgId: org.id });
  return (
    <ReadFrame
      title="Sandbox copy history"
      description={`Read from ${org.label}, the selected parent org.`}
      read={read}
      source="Salesforce Tooling API · SandboxInfo + latest SandboxProcess"
    >
      {read.data && (
        <>
          {read.data.availability === "production-only" ? (
            <div className="os-empty">Choose a production connection to read its sandboxes.</div>
          ) : (
            <>
              <p className="os-small">
                Completion is the end of the latest copy process. It does not prove activation or
                distinguish a creation from a refresh.
              </p>
              {read.data.capped && (
                <div className="os-notice">
                  <Info size={17} />
                  <p>
                    This inventory is bounded. Some sandboxes or older process details may be
                    omitted.
                  </p>
                </div>
              )}
              <div className="os-sandboxes">
                {read.data.sandboxes.map((s) => (
                  <article key={s.id}>
                    <div>
                      <h3>{s.name}</h3>
                      <span className="os-tag">{s.license || "Sandbox"}</span>
                      <span className="os-tag">{s.status || "Status not reported"}</span>
                    </div>
                    {s.description && <p>{s.description}</p>}
                    <dl className="os-facts">
                      <div>
                        <dt>Copy requested</dt>
                        <dd>{dateLabel(s.requestedAt)}</dd>
                      </div>
                      <div>
                        <dt>Copy completed</dt>
                        <dd>{dateLabel(s.completedAt)}</dd>
                      </div>
                    </dl>
                    {s.progress !== null && <p>Copy progress: {s.progress}%</p>}
                  </article>
                ))}
              </div>
              {!read.data.sandboxes.length && (
                <div className="os-empty">No sandboxes are visible to this production login.</div>
              )}
            </>
          )}
        </>
      )}
    </ReadFrame>
  );
}

function Environments({ org, orgs, dispatch }: { org: Org; orgs: Org[]; dispatch: SetupDispatch }) {
  const read = useRead(dispatch, "orgs.overview", { orgId: org.id });
  const candidates = orgs.filter(
    (o) => o.isSandbox === false && o.environment !== "scratch" && o.environment !== "developer",
  );
  const [parentId, setParentId] = useState(candidates.find((o) => o.id === org.id)?.id ?? "");
  const parent = candidates.find((o) => o.id === parentId);
  return (
    <>
      <ReadFrame
        title="Environment lifecycle"
        description="Keep track of temporary orgs and sandbox copies."
        read={read}
        source="Salesforce CLI org discovery"
      >
        {read.data && (
          <>
            <Expiry overview={read.data} />
            {read.data.environment !== "scratch" && (
              <div className="os-notice">
                <Clock size={18} />
                <p>
                  {read.data.environment === "sandbox"
                    ? "Sandbox copy history is owned by the source production org. Select that connection below."
                    : "This login is not reported as a scratch org. Scratch expiry applies only to scratch environments."}
                </p>
              </div>
            )}
          </>
        )}
      </ReadFrame>
      <label className="os-parent">
        Parent production connection
        <select
          aria-label="Parent production connection"
          data-testid="org-settings-parent"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
        >
          <option value="">Choose the source production org…</option>
          {candidates.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label} · {o.username}
            </option>
          ))}
        </select>
      </label>
      {parent ? (
        <SandboxInventory key={parent.id} org={parent} dispatch={dispatch} />
      ) : (
        <div className="os-empty">
          <Layers size={28} />
          <strong>Choose the parent org</strong>
          <p>
            Connect the source production org in Connections to see its sandbox inventory and latest
            copy status.
          </p>
        </div>
      )}
    </>
  );
}

export function OrgSettings({
  orgs,
  initialOrgId,
  activeOrgId,
  initialPage = "overview",
  activePage,
  onPageChange,
  dispatch,
  connections,
  cli,
  banner,
  modRecords,
  onStepChange,
  hideNavigation = false,
  pageRevision = 0,
  onDetailChange,
}: {
  orgs: Org[];
  initialOrgId?: string | undefined;
  activeOrgId?: string | undefined;
  hideNavigation?: boolean;
  pageRevision?: number;
  onDetailChange?: ((detail: string | null) => void) | undefined;
  initialPage?: SettingsPage | undefined;
  activePage?: SettingsPage | undefined;
  onPageChange?: ((page: SettingsPage) => void) | undefined;
  dispatch: SetupDispatch;
  connections: ReactNode;
  cli?: ReactNode;
  banner?: ReactNode;
  modRecords?: HeadfulModDescriptor[] | undefined;
  onStepChange?: ((step: string) => void) | undefined;
}) {
  const [localPage, setLocalPage] = useState<SettingsPage>(initialPage);
  const page = activePage ?? localPage;
  const localScope = ["connections", "cli", "appearance", "documentation", "mods"].includes(page);
  const setPage = (next: SettingsPage) => {
    if (onPageChange) onPageChange(next);
    else setLocalPage(next);
  };
  useEffect(() => {
    if (page !== "limits" && page !== "metadata") onDetailChange?.(null);
  }, [page, onDetailChange]);
  const [navigationSearch, setNavigationSearch] = useState("");
  const groups = pageGroups
    .map((group) => ({
      ...group,
      pages: group.pages.filter((item) =>
        `${group.title} ${item.title} ${item.keywords}`
          .toLowerCase()
          .includes(navigationSearch.trim().toLowerCase()),
      ),
    }))
    .filter((group) => group.pages.length);
  const [pending, setPending] = useState(0);
  const reportBusy = useCallback((change: number) => setPending((value) => value + change), []);
  const [orgId, setOrgId] = useState(
    initialOrgId || orgs.find((o) => o.isDefault)?.id || orgs[0]?.id || "",
  );
  const org =
    activeOrgId === undefined
      ? (orgs.find((o) => o.id === orgId) ?? orgs[0])
      : orgs.find((o) => o.id === activeOrgId);
  useEffect(() => {
    onStepChange?.(page);
  }, [page, onStepChange]);
  return (
    <ReadBusy.Provider value={reportBusy}>
      <section
        className="os-settings"
        data-experience="org-settings"
        data-experience-step={page}
        aria-busy={pending > 0}
        data-settings-scope={localScope ? "this-mac" : "selected-org"}
        aria-label="Org settings"
      >
        {banner}
        <SettingsDisclosureScope
          scope={`${localScope ? "this-mac" : (org?.id ?? "no-org")}:${page}`}
        >
          {!hideNavigation && (
            <label className="os-mobile-navigation">
              <span>Settings</span>
              <select
                aria-label="Settings section"
                value={page}
                onChange={(event) => {
                  setPage(event.target.value as SettingsPage);
                  setNavigationSearch("");
                }}
              >
                {pageGroups.map((group) => (
                  <optgroup key={group.title} label={group.title}>
                    {group.pages.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
          <div className={`os-layout ${hideNavigation ? "os-layout-content" : ""}`}>
            {!hideNavigation && (
              <nav aria-label="Settings sections">
                <h2 className="os-nav-title">Settings</h2>
                <label className="os-search os-nav-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    aria-label="Search settings"
                    placeholder="Search settings…"
                    value={navigationSearch}
                    onChange={(event) => setNavigationSearch(event.target.value)}
                  />
                </label>
                {groups.map((group) => (
                  <div className="os-nav-group" key={group.title}>
                    <span className="os-eyebrow">{group.title}</span>
                    {group.pages.map(({ id, title, icon: Icon }) => (
                      <button
                        key={id}
                        data-testid={`org-settings-${id}`}
                        aria-current={page === id ? "page" : undefined}
                        onClick={() => {
                          setPage(id);
                          setNavigationSearch("");
                        }}
                      >
                        <Icon size={16} aria-hidden="true" /> {title}
                      </button>
                    ))}
                  </div>
                ))}
                {!groups.length && (
                  <p className="os-small" role="status">
                    No settings match.
                  </p>
                )}
              </nav>
            )}
            <div
              className="os-main"
              key={`${localScope ? "this-mac" : (org?.id ?? "no-org")}:${page}:${pageRevision}`}
            >
              <div className="os-page-content">
                {localScope && (
                  <p className="os-scope-label">This Mac · Shared across org workspaces</p>
                )}
                {activeOrgId === undefined && !localScope && (
                  <div className="os-context">
                    <label>
                      Selected connection
                      <select
                        data-testid="org-settings-org"
                        aria-label="Selected connection"
                        value={org?.id ?? ""}
                        onChange={(e) => setOrgId(e.target.value)}
                      >
                        {!orgs.length && <option value="">No connected orgs</option>}
                        {orgs.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label} · {o.username}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="os-tag">Read only</span>
                  </div>
                )}
                {page === "mods" ? (
                  <HeadfulMods fixtureRecords={modRecords} />
                ) : page === "connections" ? (
                  connections
                ) : page === "cli" ? (
                  (cli ?? <p>Open Salesforce CLI setup from the workspace.</p>)
                ) : page === "appearance" ? (
                  <AppearanceSettings />
                ) : page === "documentation" ? (
                  <SetupGuide navigate={setPage} />
                ) : !org ? (
                  <div className="os-empty">
                    <Plug size={30} />
                    <strong>Connect an org to get started</strong>
                    <p>Your org’s identity, capacity and metadata will appear here.</p>
                    <button onClick={() => setPage("connections")}>
                      Open Connections <ArrowRight size={16} />
                    </button>
                  </div>
                ) : (
                  <div key={`${org.id}:${page}`}>
                    {page === "overview" && (
                      <Overview org={org} dispatch={dispatch} navigate={setPage} />
                    )}
                    {page === "limits" && (
                      <LicensingUsage
                        org={org}
                        dispatch={dispatch}
                        onDetailChange={onDetailChange}
                      />
                    )}
                    {page === "metadata" && (
                      <Metadata org={org} dispatch={dispatch} onDetailChange={onDetailChange} />
                    )}
                    {page === "environments" && (
                      <Environments org={org} orgs={orgs} dispatch={dispatch} />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </SettingsDisclosureScope>
      </section>
    </ReadBusy.Provider>
  );
}
