/* oxlint-disable shadcn/no-unknown-classes -- Focused Headful surface uses its own scoped stylesheet. */
import {
  createContext,
  lazy,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import { Check, ChevronDown, ExternalLink, Plus, Menu, Search, X } from "lucide-react";
import type { HeadfulResult } from "@t3tools/contracts/headful";
import { setupDispatch, type SetupDispatch, type SetupFixture } from "./setup-service";
import helmet from "./helmet.svg";
import "./salesforce-setup.css";
import { settingsPageTitles, type SettingsPage } from "./org-settings/settings-navigation";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { editorStep, resolveEditorContributions } from "./admin-workspace/editor-contributions";
import "./workspace-theme.css";
import { LazySurface, adminUtilityComponents } from "@headfulcloud/admin-utilities/web";
const OrgSettings = lazy(() =>
  import("./org-settings/OrgSettings").then((m) => ({ default: m.OrgSettings })),
);
const AdminWorkspace = lazy(() =>
  import("./admin-workspace/AdminWorkspace").then((m) => ({ default: m.AdminWorkspace })),
);
import { OrgSwitcher } from "./OrgSwitcher";
import { CliSetup } from "./CliSetup";
import { AppearanceControl } from "./Appearance";

type ManagedOrg = HeadfulResult<"orgs.list">["orgs"][number];
type Discovery = HeadfulResult<"orgs.discover">["connections"][number];
type Step = "loading" | "welcome" | "cli" | "orgs" | "workspace";
type OrgRow = {
  username: string;
  label: string;
  environment: string;
  discovered?: Discovery | undefined;
  managed?: ManagedOrg | undefined;
};
const ready = (cli: HeadfulResult<"cli.detect"> | null) =>
  Boolean(cli?.selected && ["ready", "multiple"].includes(cli.state));
const environmentLabels: Record<string, string> = {
  production: "Production",
  sandbox: "Development",
  developer: "Development",
  development: "Development",
  scratch: "Scratch",
  unknown: "Other orgs",
};

/** One connection component, shared by onboarding and Setup. */
export function OrgConnections({
  rows,
  busy,
  run,
  refresh,
}: {
  rows: OrgRow[];
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<unknown>;
}) {
  const [loginEnvironment, setLoginEnvironment] = useState<"production" | "sandbox" | "my-domain">(
    "production",
  );
  const [domain, setDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [search, setSearch] = useState("");
  const visibleRows = rows.filter((row) =>
    `${row.label} ${row.username} ${row.environment} ${row.managed?.salesforceOrgId ?? row.discovered?.orgId ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const [sandboxes, setSandboxes] = useState<HeadfulResult<"orgs.sandboxes"> | null>(null);
  const { dispatch } = useSetupContext();
  const login = async (
    environment: "production" | "sandbox" | "my-domain",
    instanceOrigin?: string,
    alias?: string,
  ) => {
    setLoggingIn(true);
    try {
      await dispatch("orgs.login", {
        environment,
        ...(instanceOrigin ? { instanceOrigin } : {}),
        ...(alias ? { alias } : {}),
      });
      await refresh();
      setAdding(false);
      setSandboxes(null);
    } finally {
      setLoggingIn(false);
    }
  };
  return (
    <section className="sf-connections" aria-label="Salesforce org connections">
      <div className="sf-section-heading">
        <div>
          <h2>Org connections</h2>
          <p>Choose which Salesforce logins Headful can use.</p>
        </div>
        <button className="sf-secondary" onClick={() => setAdding(!adding)} disabled={busy}>
          <Plus size={15} /> Add org
        </button>
      </div>
      <div className="sf-access-note">
        Enable a login to use its workspace and allow agents within their granted access. Salesforce
        permissions apply; provider changes require review.
      </div>
      {adding && (
        <form
          className="sf-add-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              login(loginEnvironment, loginEnvironment === "my-domain" ? domain : undefined),
            );
          }}
        >
          <div className="sf-add-heading">
            <h3>Connect an org</h3>
            <p>Choose where you sign in. Your browser handles authentication.</p>
          </div>
          <label>
            Login destination
            <select
              value={loginEnvironment}
              onChange={(event) =>
                setLoginEnvironment(event.target.value as typeof loginEnvironment)
              }
              disabled={busy}
            >
              <option value="production">Production / Developer Edition</option>
              <option value="sandbox">Sandbox</option>
              <option value="my-domain">My Domain</option>
            </select>
          </label>
          {loginEnvironment === "my-domain" && (
            <label>
              Salesforce HTTPS address
              <input
                type="url"
                required
                placeholder="https://acme.my.salesforce.com"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                disabled={busy}
              />
            </label>
          )}
          <p role={loggingIn ? "status" : undefined}>
            {loggingIn
              ? "Finish signing in in your browser, then return here. This page updates when sign-in completes."
              : "Sign in in your browser. Salesforce CLI keeps the credentials on this Mac."}
          </p>
          <button
            type="button"
            className="sf-secondary"
            disabled={busy}
            onClick={() => setAdding(false)}
          >
            Cancel
          </button>
          <button className="sf-primary" disabled={busy}>
            {loggingIn ? "Waiting for browser sign-in…" : "Continue to Salesforce"}{" "}
            <ExternalLink size={14} />
          </button>
        </form>
      )}
      {rows.length > 0 && (
        <label className="sf-org-search sf-connections-search">
          <Search size={14} aria-hidden="true" />
          <input
            aria-label="Find a connection"
            placeholder="Find a connection…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              type="button"
              aria-label="Clear connection search"
              onClick={() => setSearch("")}
            >
              <X size={13} />
            </button>
          )}
        </label>
      )}
      {rows.length > 0 && !visibleRows.length && (
        <p className="sf-empty" role="status">
          No connections match “{search.trim()}”.
        </p>
      )}
      {!rows.length && (
        <div className="sf-empty">
          <h3>No Salesforce orgs yet</h3>
          <p>
            Connect a production org, Developer Edition, or sandbox. Existing scratch orgs appear
            when they are authenticated in Salesforce CLI.
          </p>
        </div>
      )}
      {["production", "development", "scratch", "unknown"].map((environment) => {
        const group = visibleRows.filter((row) =>
          environment === "development"
            ? ["sandbox", "developer"].includes(row.environment)
            : row.environment === environment,
        );
        if (!group.length) return null;
        return (
          <div className="sf-org-group" key={environment}>
            <h3>
              {environmentLabels[environment]} <span>{group.length}</span>
            </h3>
            {group.map((row) => {
              const org = row.managed;
              const expired = Boolean(
                row.discovered?.expirationDate &&
                new Date(row.discovered.expirationDate).getTime() < Date.now(),
              );
              const needsLogin =
                !row.discovered ||
                expired ||
                (org && org.status !== "connected") ||
                (row.discovered?.connectedStatus && row.discovered.connectedStatus !== "Connected");
              const status = !row.discovered
                ? "CLI login missing"
                : expired
                  ? "Expired"
                  : needsLogin
                    ? "Reconnect required"
                    : org
                      ? "Connected"
                      : "CLI login detected";
              return (
                <article className="sf-org-row" key={row.username}>
                  <div className={`sf-org-mark ${environment}`} aria-hidden="true">
                    {environment === "production" ? "P" : environment === "scratch" ? "S" : "D"}
                  </div>
                  <div className="sf-org-detail">
                    <strong>{row.label}</strong>
                    <div className="sf-username">
                      Signed in as <span>{row.username}</span>
                    </div>
                    <div className={`sf-org-status ${needsLogin ? "sf-warning" : ""}`}>
                      {status}
                      {row.discovered?.expirationDate
                        ? ` · Expires ${row.discovered.expirationDate.slice(0, 10)}`
                        : ""}
                      {org && !org.agentEnabled ? " · Disabled in Headful" : ""}
                    </div>
                  </div>
                  <details className="sf-row-menu">
                    <summary aria-label={`Connection options for ${row.label}`}>
                      <ChevronDown size={16} />
                    </summary>
                    <div>
                      <button
                        disabled={
                          busy || expired || !(org?.instanceOrigin || row.discovered?.instanceUrl)
                        }
                        onClick={() => {
                          void run(() =>
                            login("my-domain", org?.instanceOrigin || row.discovered?.instanceUrl),
                          );
                        }}
                      >
                        Reconnect as another user <ExternalLink size={13} />
                      </button>
                      {org && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            void run(async () => {
                              await dispatch("orgs.health", { orgId: org.id });
                              await refresh();
                            });
                          }}
                        >
                          Check connection
                        </button>
                      )}
                      {org && environment === "production" && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            void run(async () => {
                              setSandboxes(await dispatch("orgs.sandboxes", { orgId: org.id }));
                            });
                          }}
                        >
                          Find sandboxes
                        </button>
                      )}
                    </div>
                  </details>
                  <button
                    className="sf-switch"
                    role="switch"
                    aria-checked={Boolean(org?.agentEnabled)}
                    aria-label={`Enable ${row.label}`}
                    disabled={busy || Boolean(needsLogin)}
                    onClick={() => {
                      void run(async () => {
                        const imported =
                          org ??
                          (await dispatch("orgs.import", {
                            username: row.username,
                            ...(row.discovered?.alias ? { alias: row.discovered.alias } : {}),
                          }));
                        await dispatch("orgs.update", {
                          orgId: imported.id,
                          agentEnabled: !imported.agentEnabled,
                        });
                        await refresh();
                      });
                    }}
                  >
                    <span />
                  </button>
                </article>
              );
            })}
          </div>
        );
      })}
      {sandboxes && (
        <section className="sf-sandboxes">
          <div className="sf-section-heading">
            <h3>Sandboxes of {sandboxes.org.label}</h3>
            <button aria-label="Close sandbox list" onClick={() => setSandboxes(null)}>
              <X size={16} />
            </button>
          </div>
          <p>
            {sandboxes.message ||
              "Sandbox inventory is separate from CLI logins. Choose a sandbox, then sign in to its Salesforce account."}
          </p>
          {sandboxes.availability === "available" && !sandboxes.sandboxes.length && (
            <p>No sandboxes are visible to this production login.</p>
          )}
          {sandboxes.sandboxes.map((sandbox) => {
            const connected = rows.some(
              (row) =>
                row.environment === "sandbox" &&
                row.username.toLowerCase() ===
                  `${sandboxes.org ? rows.find((row) => row.managed?.id === sandboxes.org.id)?.username : ""}.${sandbox.SandboxName}`.toLowerCase(),
            );
            return (
              <div className="sf-sandbox-row" key={sandbox.Id}>
                <div>
                  <strong>{sandbox.SandboxName}</strong>
                  <small>
                    {sandbox.LicenseType || "Sandbox"} ·{" "}
                    {connected ? "CLI login detected" : "No matching CLI login"}
                  </small>
                </div>
                <button
                  className="sf-secondary"
                  disabled={busy}
                  onClick={() => {
                    void run(() =>
                      login(
                        "sandbox",
                        undefined,
                        sandbox.SandboxName.match(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/)
                          ? sandbox.SandboxName
                          : undefined,
                      ),
                    );
                  }}
                >
                  {connected ? "Reconnect" : "Connect"} <ExternalLink size={13} />
                </button>
              </div>
            );
          })}
        </section>
      )}
      <p className="sf-footnote">
        Each username is a separate connection. Switching logins keeps saved work tied to its
        original org and user.
      </p>
    </section>
  );
}

const SetupContext = createContext<{ dispatch: SetupDispatch }>({ dispatch: setupDispatch });
const useSetupContext = () => useContext(SetupContext);

export function SalesforceSetup({
  dispatch = setupDispatch,
  fixture,
  initialStep,
  onReplay,
  onStepChange,
}: {
  dispatch?: SetupDispatch;
  fixture?: SetupFixture;
  initialStep?: "welcome" | "cli" | "orgs" | "workspace";
  onReplay?: () => void;
  onStepChange?: ((step: string) => void) | undefined;
}) {
  const [step, setStep] = useState<Step>(initialStep ?? "loading");
  const [cli, setCli] = useState<HeadfulResult<"cli.detect"> | null>(null);
  const [managed, setManaged] = useState<ManagedOrg[]>([]);
  const [discovered, setDiscovered] = useState<Discovery[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(() => {
    const id = history.state?.headfulOrgId;
    return typeof id === "string" ? id : "";
  });
  const [visitedOrgs, setVisitedOrgs] = useState<string[]>([]);
  const [editorMods, setEditorMods] = useState<HeadfulResult<"mods.list">["mods"]>([]);
  const [editorFeatures, setEditorFeatures] = useState<HeadfulResult<"features.list">["features"]>(
    [],
  );
  const initialNavigation = history.state?.headfulNavigation;
  const hasSettingsNavigation =
    initialNavigation?.view === "settings" &&
    Object.hasOwn(settingsPageTitles, initialNavigation.page);
  const [settingsOpen, setSettingsOpen] = useState(Boolean(hasSettingsNavigation));
  const [settingsPage, setSettingsPage] = useState<SettingsPage>(
    hasSettingsNavigation ? (initialNavigation.page as SettingsPage) : "overview",
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigationToggle = useRef<HTMLButtonElement>(null);
  const [workspaceTools, setWorkspaceTools] = useState<Record<string, string>>({});
  const [navigationRequest, setNavigationRequest] = useState<{
    orgId: string;
    tool: string;
    revision: number;
  }>();
  const [settingsPageRevision, setSettingsPageRevision] = useState(0);
  const [settingsDetail, setSettingsDetail] = useState<string | null>(null);
  const sidebarTools = useMemo(
    () => resolveEditorContributions(editorMods, editorFeatures, adminUtilityComponents).tools,
    [editorMods, editorFeatures],
  );
  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
    if (window.matchMedia?.("(max-width: 760px)").matches) navigationToggle.current?.focus();
  }, []);
  const updateWorkspaceTool = useCallback((orgId: string, tool: string) => {
    setWorkspaceTools((current) =>
      current[orgId] === tool ? current : { ...current, [orgId]: tool },
    );
  }, []);
  const appRoot = useRef<HTMLElement>(null);
  useEffect(() => {
    if (step && appRoot.current) appRoot.current.scrollTop = 0;
  }, [step]);
  const settingsHeading = useRef<HTMLHeadingElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const cliMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !cliMenu.current?.contains(event.target))
        cliMenu.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const settingsReturnFocus = useRef<HTMLElement | null>(null);
  const navigateSettings = useCallback((page: SettingsPage) => {
    const current = history.state?.headfulNavigation;
    if (current?.view !== "settings" || current.page !== page)
      history.pushState({ ...history.state, headfulNavigation: { view: "settings", page } }, "");
    setSettingsPage(page);
    setSettingsPageRevision((value) => value + 1);
    setSettingsDetail(null);
    setSettingsOpen(true);
  }, []);
  const openSetup = useCallback(
    (page: SettingsPage) => {
      const control = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const menu = control?.closest(".sf-header-menu, .sf-org-switcher");
      settingsReturnFocus.current = menu?.querySelector<HTMLElement>("summary") ?? control;
      menu?.removeAttribute("open");
      navigateSettings(page);
    },
    [navigateSettings],
  );
  const returnHome = useCallback(() => {
    history.pushState({ ...history.state, headfulNavigation: { view: "home" } }, "");
    setSettingsOpen(false);
  }, []);
  useEffect(() => {
    const restore = () => {
      const navigation = history.state?.headfulNavigation;
      const isSettings =
        navigation?.view === "settings" && Object.hasOwn(settingsPageTitles, navigation.page);
      setSettingsOpen(isSettings);
      if (isSettings) setSettingsPage(navigation.page as SettingsPage);
      const id = history.state?.headfulOrgId;
      setSelected(typeof id === "string" ? id : "");
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const previouslyInSettings = useRef(settingsOpen);
  useEffect(() => {
    if (settingsOpen) settingsHeading.current?.focus();
    else if (previouslyInSettings.current) {
      const previous = settingsReturnFocus.current;
      const target =
        previous?.isConnected && previous.closest(".sf-app")
          ? previous
          : (settingsTrigger.current ??
            appRoot.current?.querySelector<HTMLButtonElement>('[data-testid="setup-start"]'));
      target?.focus();
    }
    previouslyInSettings.current = settingsOpen;
  }, [settingsOpen]);
  const lock = useRef(false);
  useEffect(() => {
    onStepChange?.(step);
  }, [step, onStepChange]);
  const mounted = useRef(true);
  const refreshEditor = useCallback(async () => {
    const [featureStatus, modStatus] = await Promise.all([
      dispatch("features.list", {}),
      dispatch("mods.list", {}).catch(() => ({ apiVersion: 1 as const, mods: [] })),
    ]);
    if (!mounted.current) return;
    setEditorFeatures(featureStatus.features);
    setEditorMods(modStatus.mods);
    return featureStatus;
  }, [dispatch]);
  const wasSettingsOpen = useRef(false);
  useEffect(() => {
    if (wasSettingsOpen.current && !settingsOpen)
      void refreshEditor().catch(() => {
        if (mounted.current) setEditorMods([]);
      });
    wasSettingsOpen.current = settingsOpen;
  }, [settingsOpen, refreshEditor]);
  const refresh = useCallback(async () => {
    const [status, detected, saved] = await Promise.all([
      refreshEditor(),
      dispatch("cli.detect", {}),
      dispatch("orgs.list", {}),
    ]);
    if (!mounted.current) return;
    setCli(detected);
    if (!mounted.current) return;
    setManaged(saved.orgs);
    if (ready(detected)) {
      try {
        const found = await dispatch("orgs.discover", {});
        if (mounted.current) setDiscovered(found.connections);
      } catch (error) {
        if (mounted.current) setDiscovered([]);
        throw error;
      }
    } else setDiscovered([]);
    return status;
  }, [dispatch, refreshEditor]);
  const run = useCallback(async (action: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      if (mounted.current)
        setError(
          "Headful could not complete this step. Check Salesforce CLI or the connection, then try again.",
        );
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void run(async () => {
      const status = await refresh();
      if (mounted.current && !initialStep && status)
        setStep(status.onboardingComplete ? "workspace" : "welcome");
    });
    return () => {
      mounted.current = false;
    };
  }, [initialStep, refresh, run]);
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState !== "hidden") void run(refresh);
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [refresh, run]);
  useEffect(
    () =>
      window.headfulBridge?.onNavigate?.((route) => {
        if (/^(mods|integrations)(?:\?|$)/.test(route)) openSetup("mods");
        else if (/^(settings|setup|orgs)(?:\?|$)/.test(route))
          openSetup(route.startsWith("settings") ? "overview" : "connections");
      }),
    [openSetup],
  );
  const rows: OrgRow[] = discovered.map((connection) => ({
    username: connection.username,
    label: connection.alias || connection.username,
    environment:
      connection.environment === "scratch"
        ? "scratch"
        : (managed.find((org) => org.username === connection.username)?.environment ??
          connection.environment),
    discovered: connection,
    managed: managed.find(
      (org) =>
        org.username === connection.username &&
        (!connection.orgId || org.salesforceOrgId.slice(0, 15) === connection.orgId.slice(0, 15)),
    ),
  }));
  for (const org of managed)
    if (!rows.some((row) => row.managed?.id === org.id))
      rows.push({
        username: org.username,
        label: org.label,
        environment:
          org.environment ??
          (org.isSandbox === null ? "unknown" : org.isSandbox ? "sandbox" : "production"),
        managed: org,
      });
  for (const row of rows) if (row.managed) row.label = row.managed.label;
  const enabled = managed.filter(
    (org) =>
      org.agentEnabled &&
      org.status === "connected" &&
      rows.some(
        (row) =>
          row.managed?.id === org.id &&
          row.discovered &&
          (!row.discovered.connectedStatus || row.discovered.connectedStatus === "Connected") &&
          (!row.discovered.expirationDate ||
            new Date(row.discovered.expirationDate).getTime() > Date.now()),
      ),
  );
  const active =
    enabled.find((org) => org.id === selected) ??
    enabled.find((org) => org.isDefault) ??
    enabled[0];
  const cliPanel = (
    <CliSetup
      cli={cli}
      busy={busy}
      recheck={() => {
        void run(refresh);
      }}
      configure={(path) => {
        void run(async () => {
          await dispatch("cli.configure", { path });
          await refresh();
        });
      }}
    />
  );
  const connections = <OrgConnections rows={rows} busy={busy} run={run} refresh={refresh} />;
  const context = useMemo(() => ({ dispatch }), [dispatch]);
  return (
    <SetupContext.Provider value={context}>
      <main
        ref={appRoot}
        className={`sf-app sf-geist ${step === "workspace" ? "sf-app-workspace" : ""}`}
        data-native={window.desktopBridge ? "true" : undefined}
        data-headful-setup=""
        data-experience="salesforce-setup"
        data-experience-step={step}
        aria-busy={busy}
      >
        {fixture && (
          <div className="sf-fixture">
            Development fixture · Fictional orgs · No Salesforce calls <span>{fixture}</span>
            <button onClick={onReplay}>Reset / replay</button>
          </div>
        )}
        {(step === "workspace" || settingsOpen) && (
          <header className="sf-header">
            <div className="sf-brand" aria-label="Headful">
              <img src={helmet} alt="Headful" />
            </div>
            <OrgSwitcher
              orgs={managed.map((org) => {
                const row = rows.find((item) => item.managed?.id === org.id);
                return {
                  id: org.id,
                  label: org.label,
                  username: org.username,
                  salesforceOrgId: org.salesforceOrgId,
                  environment: environmentLabels[row?.environment ?? "unknown"] ?? "Other orgs",
                  available: enabled.some((item) => item.id === org.id),
                  reason: !ready(cli)
                    ? "CLI needs attention"
                    : !org.agentEnabled
                      ? "Not enabled in Headful"
                      : !row?.discovered
                        ? "CLI login missing"
                        : "Reconnect required",
                };
              })}
              selectedId={active?.id}
              onSelect={(id) => {
                if (!enabled.some((org) => org.id === id)) return;
                history.replaceState({ ...history.state, headfulOrgId: id }, "");
                setVisitedOrgs((current) => [
                  ...new Set([...current, ...(active ? [active.id] : []), id]),
                ]);
                setSelected(id);
              }}
              onManage={() => openSetup("connections")}
              openDisabled={busy || !ready(cli)}
              onOpen={
                active
                  ? () => {
                      void run(() => dispatch("orgs.open", { orgId: active.id }));
                    }
                  : undefined
              }
            />
            <span className="sf-header-environment">
              {active
                ? environmentLabels[
                    rows.find((row) => row.managed?.id === active.id)?.environment ?? "unknown"
                  ]
                : "No connection"}
            </span>
          </header>
        )}
        <div
          className={`sf-frame ${step === "workspace" || settingsOpen ? "sf-frame-composed" : ""}`}
        >
          {(step === "workspace" || settingsOpen) && (
            <WorkspaceSidebar
              settings={settingsOpen}
              page={settingsPage}
              activeTool={workspaceTools[active?.id ?? ""] ?? "schema"}
              tools={sidebarTools}
              open={sidebarOpen}
              onClose={closeSidebar}
              trigger={settingsTrigger}
              onHome={returnHome}
              onSettings={openSetup}
              onTool={(tool) => {
                if (active)
                  setNavigationRequest((current) => ({
                    orgId: active.id,
                    tool,
                    revision: (current?.revision ?? 0) + 1,
                  }));
              }}
              footer={
                <details
                  className="sf-header-menu"
                  ref={cliMenu}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cliMenu.current?.removeAttribute("open");
                      cliMenu.current?.querySelector("summary")?.focus();
                    }
                  }}
                >
                  <summary>
                    <span className={`sf-status-dot ${ready(cli) ? "ready" : ""}`} />
                    <span>{ready(cli) ? "CLI ready" : "Setup needs attention"}</span>
                    <ChevronDown size={14} />
                  </summary>
                  <div>
                    <button
                      onClick={() => {
                        openSetup("connections");
                      }}
                    >
                      Setup
                    </button>
                    <button onClick={() => openSetup("cli")}>Salesforce CLI</button>
                    <button onClick={() => openSetup("documentation")}>Documentation</button>
                    <AppearanceControl idPrefix="appearance-menu" />
                    <button
                      disabled={busy}
                      onClick={() => {
                        cliMenu.current?.removeAttribute("open");
                        cliMenu.current?.querySelector("summary")?.focus();
                        void run(refresh);
                      }}
                    >
                      Refresh connections
                    </button>
                  </div>
                </details>
              }
            />
          )}
          <div className="sf-frame-content">
            {(step === "workspace" || settingsOpen) && (
              <header className="sf-page-bar">
                <button
                  ref={navigationToggle}
                  className="sf-navigation-toggle"
                  aria-label="Toggle navigation"
                  aria-expanded={sidebarOpen}
                  aria-controls="workspace-navigation"
                  onClick={() => setSidebarOpen((value) => !value)}
                >
                  <Menu size={17} />
                </button>
                <nav aria-label="Current location" className="sf-breadcrumb">
                  <ol>
                    <li>
                      <button
                        onClick={settingsOpen ? () => navigateSettings("overview") : returnHome}
                      >
                        {settingsOpen ? "Settings" : "Workspace"}
                      </button>
                    </li>
                    <li aria-hidden="true">/</li>
                    <li aria-current={settingsDetail ? undefined : "page"}>
                      {settingsOpen ? (
                        settingsDetail ? (
                          <button onClick={() => navigateSettings(settingsPage)}>
                            {settingsPageTitles[settingsPage]}
                          </button>
                        ) : (
                          settingsPageTitles[settingsPage]
                        )
                      ) : (
                        (sidebarTools.find(
                          (item) =>
                            editorStep(item.contribution.id, item.contribution.componentId) ===
                            (workspaceTools[active?.id ?? ""] ?? "schema"),
                        )?.contribution.name ?? "Objects & fields")
                      )}
                    </li>
                    {settingsOpen && settingsDetail && (
                      <>
                        <li aria-hidden="true">/</li>
                        <li aria-current="page">{settingsDetail}</li>
                      </>
                    )}
                  </ol>
                </nav>
              </header>
            )}

            <div className="sf-main" hidden={settingsOpen}>
              {step === "loading" ? (
                <div className="sf-loading" role="status">
                  <img className="sf-startup-helmet" src={helmet} alt="" />
                  <span>Opening Headful…</span>
                  {error && (
                    <>
                      <p role="alert">{error}</p>
                      <button
                        className="sf-secondary"
                        onClick={() => {
                          void run(async () => {
                            const status = await dispatch("features.list", {});
                            setStep(status.onboardingComplete ? "workspace" : "welcome");
                            await refresh();
                          });
                        }}
                      >
                        Try again
                      </button>
                    </>
                  )}
                </div>
              ) : step !== "workspace" ? (
                <div className="sf-onboarding">
                  <div className="sf-brand">
                    <img src={helmet} alt="" />
                    <span>Headful</span>
                  </div>
                  <nav className="sf-steps" aria-label="Setup progress">
                    {["Welcome", "Salesforce CLI", "Your orgs"].map((label, index) => (
                      <span
                        key={label}
                        aria-current={
                          index === (step === "welcome" ? 0 : step === "cli" ? 1 : 2)
                            ? "step"
                            : undefined
                        }
                      >
                        <i>{index + 1}</i>
                        {label}
                      </span>
                    ))}
                  </nav>
                  {step === "welcome" ? (
                    <div className="sf-welcome">
                      <div className="sf-eyebrow">A HARNESS FOR YOUR ORG</div>
                      <h1>Welcome to Headful</h1>
                      <p>
                        Connect your Salesforce orgs, explore your data, and give your agents a
                        clear place to work.
                      </p>
                      <div className="sf-welcome-points">
                        <span>
                          <Check size={16} /> Use your existing Salesforce CLI logins
                        </span>
                        <span>
                          <Check size={16} /> Choose the orgs your agents can access
                        </span>
                        <span>
                          <Check size={16} /> Credentials stay with Salesforce CLI
                        </span>
                      </div>
                      <button
                        className="sf-primary"
                        data-testid="setup-start"
                        onClick={() => setStep("cli")}
                      >
                        Get started <span>→</span>
                      </button>
                      <small>No Headful account needed.</small>
                      <p className="sf-independence">
                        Headful is independent and is not affiliated with Salesforce.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="sf-page-title">
                        <h1>
                          {step === "cli" ? "Check Salesforce CLI" : "Choose your workspaces"}
                        </h1>
                        <p>
                          {step === "cli"
                            ? "Headful uses Salesforce CLI for secure, local authentication."
                            : "Your authenticated production, development, and scratch orgs appear here."}
                        </p>
                      </div>
                      {cliPanel}
                      {step === "orgs" && ready(cli) && connections}
                    </>
                  )}
                  {error && (
                    <p className="sf-error" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="sf-onboarding-preferences">
                    <AppearanceControl idPrefix="appearance-setup" />
                  </div>
                  {step !== "welcome" && (
                    <footer className="sf-wizard-footer">
                      <button
                        className="sf-secondary"
                        disabled={busy}
                        onClick={() => setStep(step === "cli" ? "welcome" : "cli")}
                      >
                        Back
                      </button>
                      {step === "cli" ? (
                        <button
                          className="sf-primary"
                          disabled={busy || !ready(cli)}
                          data-testid="setup-choose-orgs"
                          onClick={() => setStep("orgs")}
                        >
                          Choose orgs →
                        </button>
                      ) : (
                        <button
                          className="sf-primary"
                          data-testid="setup-finish"
                          disabled={busy || !ready(cli)}
                          onClick={() => {
                            void run(async () => {
                              await dispatch("onboarding.complete", { mode: "minimal" });
                              setStep("workspace");
                            });
                          }}
                        >
                          {enabled.length ? "Open Headful →" : "Finish setup →"}
                        </button>
                      )}
                    </footer>
                  )}
                </div>
              ) : (
                <>
                  <div className="sf-workspace">
                    <section className="sf-workspace-content">
                      {!active && (
                        <div className="sf-workspace-heading">
                          <h1>Connect your first org</h1>
                          <p>Use Manage orgs to connect an org and enable access.</p>
                        </div>
                      )}
                      {active &&
                        enabled
                          .filter((org) => org.id === active.id || visitedOrgs.includes(org.id))
                          .map((org) => (
                            <div
                              className="sf-org-workspace"
                              key={org.id}
                              hidden={org.id !== active.id}
                            >
                              <LazySurface label="org workspace">
                                <AdminWorkspace
                                  org={org}
                                  dispatch={dispatch}
                                  mods={editorMods}
                                  features={editorFeatures}
                                  onManageMods={() => openSetup("mods")}
                                  sidebarNavigation
                                  navigationRequest={
                                    navigationRequest?.orgId === org.id
                                      ? navigationRequest
                                      : undefined
                                  }
                                  onStepChange={(tool) => updateWorkspaceTool(org.id, tool)}
                                />
                              </LazySurface>
                            </div>
                          ))}
                      {!active && (
                        <button
                          className="sf-primary"
                          data-testid="workspace-connect"
                          onClick={() => {
                            openSetup("connections");
                          }}
                        >
                          Connect an org
                        </button>
                      )}
                      {active && (
                        <footer className="sf-workspace-status" aria-label="Workspace connection">
                          <span>
                            <i className="sf-status-dot ready" />
                            Connected · Enabled for agents
                          </span>
                          <span>
                            {
                              environmentLabels[
                                rows.find((row) => row.managed?.id === active.id)?.environment ||
                                  "unknown"
                              ]
                            }
                          </span>
                          <span className="sf-workspace-local">Local workspace</span>
                        </footer>
                      )}
                      {error && (
                        <p className="sf-error" role="alert">
                          {error}
                        </p>
                      )}
                    </section>
                  </div>
                </>
              )}
            </div>
            {settingsOpen && (
              <section
                className="sf-settings-page"
                aria-labelledby="settings-page-title"
                data-testid="settings-page"
              >
                <h1
                  id="settings-page-title"
                  className="sf-settings-focus"
                  ref={settingsHeading}
                  tabIndex={-1}
                >
                  Settings · {settingsPageTitles[settingsPage]}
                </h1>
                <LazySurface label="Settings">
                  <OrgSettings
                    orgs={managed}
                    initialOrgId={active?.id}
                    activeOrgId={active?.id ?? ""}
                    activePage={settingsPage}
                    hideNavigation
                    pageRevision={settingsPageRevision}
                    onDetailChange={setSettingsDetail}
                    onPageChange={navigateSettings}
                    dispatch={dispatch}
                    modRecords={fixture ? [] : undefined}
                    connections={
                      ready(cli) ? (
                        connections
                      ) : (
                        <>
                          <p className="sf-access-note">
                            Set up Salesforce CLI before managing org connections.
                          </p>
                          {cliPanel}
                        </>
                      )
                    }
                    cli={cliPanel}
                  />
                </LazySurface>
                {error && (
                  <p className="sf-error" role="alert">
                    {error}
                  </p>
                )}
              </section>
            )}
          </div>
        </div>
      </main>
    </SetupContext.Provider>
  );
}
