import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { z } from "zod";
import { headfulInputSchemas, type HeadfulOperation } from "@t3tools/contracts/headful";
import {
  identifier,
  orgSchema,
  orgsSchema,
  locationSchema,
} from "@t3tools/contracts/headful-workspace/contract-schema";
import {
  leadDatasetSchema,
  leadDetailSchema,
  permissionListSchema,
  permissionDetailSchema,
  preparedPermissionSchema,
  permissionProposalSchema,
} from "@t3tools/contracts/headful-workspace/ui-schema";
import {
  listUsersSchema,
  userRecordSchema,
  accessStateSchema,
  workflowSchema,
  listWorkflowsSchema,
} from "@t3tools/contracts/headful-workspace/user-schema";
import { reviewCapabilitySchema } from "@t3tools/contracts/headful-workspace/workflow-schema";
import { mountWorkspace, type WorkspaceService, type WorkspaceLocation } from "./workspace-view";
import { HeadfulExtensions } from "./HeadfulExtensions";
import { HeadfulWorkspaceShell, type WorkspaceCommand } from "./HeadfulWorkspaceShell";
import { HeadfulCommandCenter, useHeadfulInbox } from "./HeadfulCommandCenter";
import { buildNotifications, type CommandDestination, type SearchEntry } from "./command-center";
import {
  headfulExtensionResultSchemas,
  resolveHeadfulContributions,
  type HeadfulExtensionDescriptor,
} from "@t3tools/contracts/headful-extensions";
import {
  adminUtilityComponents,
  orgEnvironment,
  type UtilityComponentProps,
} from "@headfulcloud/admin-utilities/web";
import helmet from "./helmet.svg";
import "./headful.css";
import "./workspace.css";

interface HeadfulBridge {
  dispatch(operation: string, input: unknown): Promise<unknown>;
  onNavigate?(listener: (route: string) => void): () => void;
}
declare global {
  interface Window {
    headfulBridge?: HeadfulBridge;
  }
}

const featureSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  availability: z.enum(["available", "experimental", "coming-soon"]),
  enabled: z.boolean(),
  dependencies: z.array(z.string()),
  configuration: z.array(z.string()).optional(),
});
const managedOrgSchema = orgSchema.extend({
  username: z.string(),
  principalId: z.string(),
  alias: z.string(),
  color: z.string(),
  agentEnabled: z.boolean(),
  remoteEnabled: z.boolean().default(false),
  isDefault: z.boolean(),
  connectionVersion: z.number(),
});
const statusSchema = z.object({
  orgs: z.array(managedOrgSchema),
  defaultOrgId: z.string().nullable(),
  features: z.array(featureSchema),
  mode: z.string(),
  onboardingComplete: z.boolean(),
});
const cliSchema = z.object({
  state: z.enum(["missing", "ready", "unsupported", "multiple"]),
  selected: z.string().nullable(),
  installations: z.array(
    z.object({ path: z.string(), version: z.string(), supported: z.boolean(), source: z.string() }),
  ),
  architecture: z.string(),
  legacyDetected: z.boolean(),
  installerUrl: z.url(),
});
const sandboxSchema = z.object({
  availability: z.string(),
  message: z.string().optional(),
  sandboxes: z
    .array(
      z.object({
        Id: z.string(),
        SandboxName: z.string(),
        Description: z.string().nullable(),
        LicenseType: z.string().nullable(),
      }),
    )
    .max(100),
});
const discoveredSchema = z.object({
  connections: z.array(
    z.object({
      username: z.string(),
      alias: z.string().optional(),
      environment: z.string(),
      orgId: z.string().optional(),
      expirationDate: z.string().optional(),
    }),
  ),
  bounded: z.boolean(),
});
const aboutSchema = z.object({
  version: z.string(),
  upstreamVersion: z.string(),
  upstreamCommit: z.string(),
  protocolVersion: z.number(),
  architecture: z.string(),
  packaged: z.boolean(),
  updates: z.string(),
  buildCommit: z.string().optional(),
});
type Status = z.infer<typeof statusSchema>;
type Org = z.infer<typeof managedOrgSchema>;
type Cli = z.infer<typeof cliSchema>;
type Discovered = z.infer<typeof discoveredSchema>["connections"];
type Page =
  | "orgs"
  | "workspace"
  | "integrations"
  | "activity"
  | "extensions"
  | "settings"
  | "utility";
const pages: Array<{
  id: Exclude<Page, "utility">;
  title: string;
  symbol: string;
  description: string;
}> = [
  {
    id: "orgs",
    title: "Your orgs",
    symbol: "☁",
    description: "Manage local Salesforce connections",
  },
  {
    id: "workspace",
    title: "Salesforce workspace",
    symbol: "▤",
    description: "Browse leads, users and permission sets",
  },
  {
    id: "integrations",
    title: "Agent connections",
    symbol: "◈",
    description: "Connect your favorite agent clients",
  },
  {
    id: "activity",
    title: "Reviewed changes",
    symbol: "✓",
    description: "Continue saved work and inspect receipts",
  },
  {
    id: "extensions",
    title: "Extensions",
    symbol: "◇",
    description: "Manage installed Extensions and their features",
  },
  {
    id: "settings",
    title: "Settings",
    symbol: "⚙",
    description: "Appearance, features and Salesforce CLI setup",
  },
];
const labels: Record<Page, string> = {
  orgs: "Your orgs",
  workspace: "Your Salesforce workspace",
  integrations: "Agent connections",
  activity: "Reviewed changes",
  extensions: "Extensions",
  settings: "Settings",
  utility: "Your admin workspace",
};

async function dispatch(operation: string, input: unknown = {}): Promise<unknown> {
  if (!window.headfulBridge)
    throw new Error(
      "Start Headful on your Mac to use its local runtime. A browser page cannot access Salesforce credentials.",
    );
  const schema = headfulInputSchemas[operation as HeadfulOperation];
  if (schema) schema.parse(input);
  return window.headfulBridge.dispatch(operation, input);
}
function errorMessage(error: unknown) {
  return error instanceof z.ZodError
    ? "The local service returned an unsupported result. Refresh or restart Headful."
    : error instanceof Error
      ? error.message
      : "Headful could not complete this operation.";
}
function createWorkspaceService(): WorkspaceService {
  return {
    listOrgs: async () => orgsSchema.parse(await dispatch("listOrgs")),
    inspectLead: async (input) => leadDetailSchema.parse(await dispatch("inspectLead", input)),
    listLeads: async (input) => leadDatasetSchema.parse(await dispatch("listLeads", input)),
    listPermissionSets: async (input) =>
      permissionListSchema.parse(await dispatch("listPermissionSets", input)),
    inspectPermissionSet: async (input) =>
      permissionDetailSchema.parse(await dispatch("inspectPermissionSet", input)),
    preparePermissionChange: async (input) =>
      preparedPermissionSchema.parse(await dispatch("preparePermissionChange", input)),
    getPermissionProposal: async (input) =>
      permissionProposalSchema.parse(await dispatch("getPermissionProposal", input)),
    reviewPermissionProposal: async (input) =>
      reviewCapabilitySchema.parse(await dispatch("reviewPermissionProposal", input)),
    applyPermissionProposal: async (input) =>
      permissionProposalSchema.parse(await dispatch("applyPermissionProposal", input)),
    rejectPermissionProposal: async (input) =>
      z.object({ status: z.string() }).parse(await dispatch("rejectPermissionProposal", input)),
    listUsers: async (input) => listUsersSchema.parse(await dispatch("listUsers", input)),
    inspectUser: async (input) => userRecordSchema.parse(await dispatch("inspectUser", input)),
    inspectUserAccess: async (input) =>
      accessStateSchema.parse(await dispatch("inspectUserAccess", input)),
    listWorkflows: async () => listWorkflowsSchema.parse(await dispatch("listWorkflows")),
    prepareUserCreation: async (input) =>
      workflowSchema.parse(await dispatch("prepareUserCreation", input)),
    getWorkflow: async (input) => workflowSchema.parse(await dispatch("getWorkflow", input)),
    saveUserDraft: async (input) => workflowSchema.parse(await dispatch("saveUserDraft", input)),
    reviewWorkflow: async (input) =>
      reviewCapabilitySchema.parse(await dispatch("reviewWorkflow", input)),
    createUser: async (input) => workflowSchema.parse(await dispatch("createUser", input)),
    reconcileUser: async (input) => workflowSchema.parse(await dispatch("reconcileUser", input)),
    getUserAccess: async (input) => accessStateSchema.parse(await dispatch("getUserAccess", input)),
    prepareUserAccess: async (input) =>
      workflowSchema.parse(await dispatch("prepareUserAccess", input)),
    applyUserAccess: async (input) =>
      workflowSchema.parse(await dispatch("applyUserAccess", input)),
    reconcileAccess: async (input) =>
      workflowSchema.parse(await dispatch("reconcileAccess", input)),
  };
}
function Workspace({
  initial,
  onNavigate,
  onInspectRecord,
}: {
  initial: WorkspaceLocation;
  onNavigate: (location: WorkspaceLocation) => void;
  onInspectRecord?:
    | ((input: { orgId: string; object: string; recordId: string }) => void)
    | undefined;
}) {
  const element = useRef<HTMLDivElement>(null);
  const initialRef = useRef(initial);
  const handle = useRef<ReturnType<typeof mountWorkspace> | null>(null);
  const service = useMemo(createWorkspaceService, []);
  useEffect(() => {
    if (!element.current) return;
    handle.current = mountWorkspace(element.current, service, {
      initial: initialRef.current,
      surface: "native",
      onNavigate,
    });
    return () => {
      handle.current?.destroy();
      handle.current = null;
    };
  }, [service, onNavigate]);
  useEffect(() => {
    handle.current?.setRecordInspector(onInspectRecord);
  }, [onInspectRecord]);
  return <div className="hf-workspace-mount" ref={element} />;
}
function Modal({
  title,
  children,
  onClose,
  error,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  error?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      returnFocus.current?.focus();
    };
  }, []);
  return (
    <dialog
      className="hf-dialog"
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="hf-dialog-heading">
        <h2>{title}</h2>
        <button
          className="hf-icon-button"
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          ×
        </button>
      </div>
      {error && (
        <p className="hf-alert" role="alert">
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}

export function HeadfulShell() {
  const [page, setPage] = useState<Page>("orgs");
  const [focusExtensionId, setFocusExtensionId] = useState<string | undefined>();
  const [status, setStatus] = useState<Status | null>(null);
  const [extensions, setExtensions] = useState<HeadfulExtensionDescriptor[]>([]);
  const [extensionSettings, setExtensionSettings] = useState<
    Record<string, Record<string, string | number | boolean>>
  >({});
  const [utilityWorkspaceId, setUtilityWorkspaceId] = useState("");
  const [utilityInput, setUtilityInput] = useState<Record<string, string | number | boolean>>({});
  const [workspaceOrgs, setWorkspaceOrgs] = useState<Record<string, string>>({});
  const [cli, setCli] = useState<Cli | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [manualPath, setManualPath] = useState("");
  const [discovered, setDiscovered] = useState<Discovered | null>(null);
  const [selectedImports, setSelectedImports] = useState<string[]>([]);
  const [connect, setConnect] = useState(false);
  const [loginEnvironment, setLoginEnvironment] = useState<"production" | "sandbox" | "my-domain">(
    "production",
  );
  const [editOrg, setEditOrg] = useState<Org | null>(null);
  const [danger, setDanger] = useState<{ org: Org; kind: "remove" | "logout" } | null>(null);
  const [sandboxes, setSandboxes] = useState<{
    org: Org;
    data: z.infer<typeof sandboxSchema>;
  } | null>(null);
  const [about, setAbout] = useState<z.infer<typeof aboutSchema> | null>(null);
  const [workspaceLocation, setWorkspaceLocation] = useState<WorkspaceLocation>({ view: "home" });
  const [theme, setTheme] = useState(() => localStorage.getItem("headful.appearance") || "system");
  const [dark, setDark] = useState(false);
  const action = useCallback(async (label: string, run: () => Promise<void>) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }, []);
  const refresh = useCallback(async () => {
    const [state, installed] = await Promise.all([dispatch("status"), dispatch("extensions.list")]);
    setStatus(statusSchema.parse(state));
    const list = headfulExtensionResultSchemas["extensions.list"].parse(installed).extensions;
    setExtensions(list);
    const settings = await Promise.all(
      list
        .filter((item) => item.status === "active")
        .map(async (item) =>
          headfulExtensionResultSchemas["extensions.settings"].parse(
            await dispatch("extensions.settings", { id: item.manifest.id }),
          ),
        ),
    );
    setExtensionSettings(Object.fromEntries(settings.map((item) => [item.id, item.values])));
  }, []);
  const enabled = useCallback(
    (id: string) => status?.features.find((feature) => feature.id === id)?.enabled ?? false,
    [status],
  );
  const reviewedEnabled = enabled("reviewed-changes") && enabled("salesforce-workspace");
  const inbox = useHeadfulInbox({
    ready: Boolean(status),
    reviewedEnabled,
    dispatch,
    refreshShell: refresh,
  });
  useEffect(() => {
    void action("Starting local runtime", async () => {
      await refresh();
      setCli(cliSchema.parse(await dispatch("cli.detect")));
    });
  }, [action, refresh]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(theme === "dark" || (theme === "system" && media.matches));
    update();
    media.addEventListener("change", update);
    localStorage.setItem("headful.appearance", theme);
    return () => media.removeEventListener("change", update);
  }, [theme]);
  const route = useCallback((value: string) => {
    const [path = "orgs", query = ""] = value.replace(/^#\/?/, "").split("?");
    const known = pages.find((item) => item.id === path.split("/")[0]);
    if (!known) return;
    if (known.id === "extensions") {
      const extensionId = new URLSearchParams(query).get("extensionId");
      setFocusExtensionId(
        extensionId && /^[a-z][a-z0-9-]{0,63}$/.test(extensionId) ? extensionId : undefined,
      );
    }
    if (known.id === "workspace") {
      const parameters = Object.fromEntries(new URLSearchParams(query));
      const parsed = locationSchema.safeParse({
        view: path.split("/")[1] || "home",
        ...parameters,
      });
      if (parsed.success) {
        setWorkspaceLocation(parsed.data);
        if (parsed.data.orgId)
          setWorkspaceOrgs((value) => ({ ...value, "core/workspace": parsed.data.orgId! }));
      }
    }
    setPage(known.id);
  }, []);
  useEffect(() => {
    if (location.hash) route(location.hash);
    return window.headfulBridge?.onNavigate?.(route);
  }, [route]);
  useEffect(() => {
    return window.desktopBridge?.onMenuAction?.((action) => {
      if (action === "open-settings") route("settings");
    });
  }, [route]);
  const navigate = (next: Page, target?: WorkspaceLocation) => {
    if (next === "workspace" && target) {
      onWorkspaceNavigate(target);
    } else if (next === "workspace" && !workspaceLocation.orgId && status?.defaultOrgId) {
      const orgId = workspaceOrgs["core/workspace"] || status.defaultOrgId;
      setWorkspaceLocation((value) => ({ ...value, orgId }));
      setWorkspaceOrgs((value) => ({ ...value, "core/workspace": orgId }));
    }
    setPage(next);
    setError("");
    setNotice("");
  };
  const onWorkspaceNavigate = useCallback((next: WorkspaceLocation) => {
    setWorkspaceLocation(next);
    if (next.orgId) setWorkspaceOrgs((value) => ({ ...value, "core/workspace": next.orgId! }));
    const { view, ...parameters } = next;
    history.replaceState(
      null,
      "",
      `#workspace/${view}?${new URLSearchParams(Object.entries(parameters).filter((entry): entry is [string, string] => typeof entry[1] === "string")).toString()}`,
    );
  }, []);
  const openWorkspace = (org: Org, view: WorkspaceLocation["view"] = "home") => {
    navigate("workspace", { orgId: org.id, view });
  };
  const current = status?.orgs.find((org) => org.id === status.defaultOrgId);
  const contributions = useMemo(
    () => resolveHeadfulContributions(extensions, status?.features ?? []),
    [extensions, status?.features],
  );
  const utilityNavigation = contributions.navigation.find(
    (item) => item.contribution.id === utilityWorkspaceId,
  );
  const workspaceId = page === "utility" ? utilityWorkspaceId : "core/workspace";
  const workspaceOrgId =
    page === "workspace"
      ? workspaceLocation.orgId || workspaceOrgs[workspaceId] || ""
      : workspaceOrgs[workspaceId] || "";
  const workspaceOrg = status?.orgs.find((org) => org.id === workspaceOrgId);
  const openUtility = (
    componentId: string,
    input: Record<string, string | number | boolean> = {},
  ) => {
    const entry = contributions.navigation.find(
      (item) => item.contribution.componentId === componentId,
    );
    if (!entry?.available) {
      setError(
        entry?.unavailableReason || "This utility is unavailable in the installed extensions.",
      );
      return;
    }
    const savedOrg = typeof input.orgId === "string" ? input.orgId : undefined;
    const orgId =
      savedOrg ||
      workspaceOrgs[entry.contribution.id] ||
      workspaceOrgId ||
      status?.defaultOrgId ||
      "";
    setWorkspaceOrgs((value) => ({ ...value, [entry.contribution.id]: orgId }));
    setUtilityWorkspaceId(entry.contribution.id);
    setUtilityInput(input);
    navigate("utility");
  };
  const selectWorkspaceOrg = (orgId: string) => {
    if (!status?.orgs.some((org) => org.id === orgId)) return;
    setWorkspaceOrgs((value) => ({ ...value, [workspaceId]: orgId }));
    if (page === "workspace") setWorkspaceLocation({ view: "home", orgId });
    else setUtilityInput({});
    setNotice("Workspace target changed explicitly. The default org and saved work are unchanged.");
  };
  const runExtensionCommand = (extensionId: string, command: string) =>
    void action("Running workspace command", async () => {
      const declaration = contributions.commands.find(
        (item) => item.extensionId === extensionId && item.contribution.id === command,
      )?.contribution;
      const input = declaration?.parameters.some((parameter) => parameter.key === "org-id")
        ? { "org-id": workspaceOrgId }
        : {};
      const result = headfulExtensionResultSchemas["extensions.command"].parse(
        await dispatch("extensions.command", { id: extensionId, command, input }),
      );
      setNotice(result.message);
    });
  const workspaceActions = contributions.actions
    .filter(
      (item) =>
        item.available &&
        (item.contribution.workspaceIds.length === 0 ||
          item.contribution.workspaceIds.includes(workspaceId)),
    )
    .map((item) => ({
      id: item.contribution.id,
      name: item.contribution.name,
      disabled: item.contribution.requiresOrg && !workspaceOrg,
      reason: !workspaceOrg ? "Choose a connected target org." : undefined,
      run: () => runExtensionCommand(item.extensionId, item.contribution.commandId),
    }));
  const utilityContext: UtilityComponentProps = {
    orgId: workspaceOrgId,
    workspaceId,
    orgs: status?.orgs ?? [],
    dispatch,
    onOrgChange: selectWorkspaceOrg,
    onNavigate: openUtility,
    onFeedback: setNotice,
    initialInput: utilityInput,
    actionContributions: workspaceActions,
  };
  const workspaceCommands: WorkspaceCommand[] = [
    ...contributions.navigation
      .filter((item) => item.available)
      .map((item) => ({
        id: item.contribution.id,
        name: item.contribution.name,
        description: item.contribution.description || "Open the contributed workspace",
        run: () => openUtility(item.contribution.componentId),
      })),
    ...contributions.commands
      .filter(
        (item) =>
          item.available &&
          item.contribution.parameters.every(
            (parameter) => !parameter.required || parameter.key === "org-id",
          ),
      )
      .map((item) => ({
        id: `${item.extensionId}/${item.contribution.id}`,
        name: item.contribution.name,
        description: item.contribution.description,
        disabled:
          item.contribution.parameters.some(
            (parameter) => parameter.key === "org-id" && parameter.required,
          ) && !workspaceOrg,
        reason: !workspaceOrg ? "Choose a connected target org." : undefined,
        run: () => runExtensionCommand(item.extensionId, item.contribution.id),
      })),
    ...(contributions.navigation.some(
      (item) => item.available && item.contribution.icon === "cloud",
    )
      ? (status?.orgs ?? []).map((org) => ({
          id: `org/${org.id}`,
          name: `Switch workspace to ${org.label}`,
          description: `${orgEnvironment(org)} · ${org.alias || org.username} · ${org.salesforceOrgId}`,
          disabled:
            page === "workspace" &&
            Boolean(workspaceLocation.workflowId || workspaceLocation.proposalId),
          reason: "Saved work is pinned. Open a new workspace first.",
          run: () => selectWorkspaceOrg(org.id),
        }))
      : []),
  ];
  const isDisabled = Boolean(busy);
  const availablePages = pages
    .filter((item) => item.id !== "workspace" || enabled("salesforce-workspace"))
    .filter((item) => item.id !== "integrations" || enabled("external-harness"))
    .filter((item) => item.id !== "activity" || reviewedEnabled);
  const searchEntries: SearchEntry[] = [
    ...availablePages.map<SearchEntry>((item) => ({
      id: `page/${item.id}`,
      title: item.title,
      description: item.description,
      group: "Pages",
      destination: { kind: "page", page: item.id },
    })),
    ...(status?.orgs ?? []).map<SearchEntry>((org) => ({
      id: `org/${org.id}`,
      title: org.label,
      description: `${orgEnvironment(org)} · ${org.alias || org.username} · ${org.salesforceOrgId}`,
      group: "Orgs",
      destination: { kind: "org", orgId: org.id },
    })),
    ...contributions.navigation
      .filter((item) => item.available)
      .map<SearchEntry>((item) => ({
        id: `utility/${item.contribution.id}`,
        title: item.contribution.name,
        description: item.contribution.description || "Open this admin workspace",
        group: "Admin utilities",
        destination: { kind: "utility", componentId: item.contribution.componentId },
      })),
    ...extensions.map<SearchEntry>((item) => ({
      id: `extension/${item.manifest.id}`,
      title: item.manifest.name,
      description: `${item.status} · ${item.manifest.description}`,
      group: "Extensions",
      destination: { kind: "extension", extensionId: item.manifest.id },
    })),
    ...(reviewedEnabled ? inbox.workflows : []).map<SearchEntry>((workflow) => ({
      id: `workflow/${workflow.id}`,
      title: workflow.createdUser
        ? `${workflow.createdUser.FirstName || ""} ${workflow.createdUser.LastName}`.trim()
        : `Create user${workflow.draft.LastName ? `: ${workflow.draft.LastName}` : ""}`,
      description: `${workflow.setup.org.label} · ${workflow.status.replaceAll("_", " ")} · ${workflow.id}`,
      group: "Saved work",
      destination: {
        kind: "workspace",
        location: {
          view: workflow.createdUser ? "user" : "create-user",
          orgId: workflow.orgId,
          workflowId: workflow.id,
          ...(workflow.recordId ? { recordId: workflow.recordId } : {}),
        },
      },
    })),
  ];
  const openSearchDestination = (destination: CommandDestination) => {
    switch (destination.kind) {
      case "page":
        navigate(destination.page);
        break;
      case "org": {
        const org = status?.orgs.find((item) => item.id === destination.orgId);
        if (!org || !enabled("salesforce-workspace")) navigate("orgs");
        else openWorkspace(org);
        break;
      }
      case "workspace":
        if (
          !reviewedEnabled ||
          !status?.orgs.some((org) => org.id === destination.location.orgId)
        ) {
          navigate(reviewedEnabled ? "activity" : "orgs");
          break;
        }
        navigate("workspace", destination.location);
        break;
      case "utility":
        openUtility(destination.componentId);
        break;
      case "extension":
        setFocusExtensionId(destination.extensionId);
        navigate("extensions");
        break;
    }
  };
  const notifications = buildNotifications({
    orgs: status?.orgs ?? [],
    cli,
    extensions,
    workflows: inbox.workflows,
    activity: inbox.activity,
    workspaceEnabled: enabled("salesforce-workspace"),
    reviewedEnabled,
  });
  const setFeature = (id: string, value: boolean) =>
    void action("Saving feature", async () => {
      await dispatch("features.set", { id, enabled: value });
      if (id === "launch-at-login") await dispatch("system.launchAtLogin", { enabled: value });
      await refresh();
    });

  const cliPanel = (
    <section className="hf-card hf-cli-card">
      <div className="hf-card-heading">
        <div>
          <p className="hf-eyebrow">YOUR ONLY REQUIRED EXTERNAL TOOL</p>
          <h2>Salesforce CLI</h2>
        </div>
        <span className={`hf-badge ${cli?.selected ? "hf-good" : ""}`}>
          {cli?.selected
            ? "Ready"
            : cli?.state === "unsupported"
              ? "Update needed"
              : "Setup needed"}
        </span>
      </div>
      <p>
        Use the supported <code>sf</code> CLI, often called SFDX. Headful uses an explicit
        executable path, including when Finder has a different PATH from your terminal.
      </p>
      {cli?.selected ? (
        <div className="hf-cli-selected">
          <strong>
            {cli.installations.find((item) => item.path === cli.selected)?.version ||
              "Salesforce CLI"}
          </strong>
          <code>{cli.selected}</code>
        </div>
      ) : (
        <p className="hf-notice">
          Install Salesforce’s official {cli?.architecture || "Mac"} package, then return here and
          recheck. Headful does not install a package manager or change your shell.
        </p>
      )}
      {cli?.legacyDetected && (
        <p className="hf-note">
          An older <code>sfdx</code> installation was detected. Choose a supported <code>sf</code>{" "}
          installation for Headful.
        </p>
      )}
      {cli && cli.installations.length > 1 && (
        <label className="hf-field">
          Available installations
          <select
            value={cli.selected || ""}
            disabled={isDisabled}
            onChange={(event) =>
              void action("Selecting CLI", async () =>
                setCli(
                  cliSchema.parse(await dispatch("cli.configure", { path: event.target.value })),
                ),
              )
            }
          >
            {cli.installations.map((item) => (
              <option key={item.path} value={item.path} disabled={!item.supported}>
                {item.path} · {item.version}
                {!item.supported ? " · unsupported" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="hf-actions">
        <button
          className="hf-button hf-primary"
          disabled={isDisabled}
          type="button"
          onClick={() =>
            void action("Opening official installer", async () => {
              await dispatch("system.openInstaller");
              setNotice("Complete the normal Salesforce installer, then choose Recheck CLI.");
            })
          }
        >
          Official Mac installer ↗
        </button>
        <button
          className="hf-button"
          disabled={isDisabled}
          type="button"
          onClick={() =>
            void action("Checking Salesforce CLI", async () =>
              setCli(cliSchema.parse(await dispatch("cli.detect"))),
            )
          }
        >
          Recheck CLI
        </button>
      </div>
      <details className="hf-advanced">
        <summary>Choose an executable manually</summary>
        <form
          className="hf-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void action("Checking chosen CLI", async () =>
              setCli(
                cliSchema.parse(await dispatch("cli.configure", { path: manualPath || null })),
              ),
            );
          }}
        >
          <label className="hf-field">
            Absolute path to <code>sf</code>
            <input
              value={manualPath}
              onChange={(event) => setManualPath(event.target.value)}
              placeholder="/opt/homebrew/bin/sf"
              maxLength={2000}
            />
          </label>
          <button className="hf-button" disabled={isDisabled}>
            Use path
          </button>
        </form>
      </details>
    </section>
  );

  return (
    <div className="hf-shell" data-theme={dark ? "dark" : "light"}>
      <aside className="hf-sidebar">
        <HeadfulCommandCenter
          entries={searchEntries}
          notifications={notifications}
          loading={inbox.loading}
          error={inbox.error}
          onRefresh={() => void inbox.refresh()}
          onNavigate={openSearchDestination}
        />
        <nav aria-label="Headful">
          <p className="hf-eyebrow">WORKSPACE</p>
          {availablePages.map((item) => (
            <button
              className={`hf-nav-button ${page === item.id ? "active" : ""}`}
              type="button"
              key={item.id}
              onClick={() => navigate(item.id)}
            >
              <span aria-hidden="true">{item.symbol}</span>
              {item.title}
            </button>
          ))}
          {contributions.routes
            .filter((item) => item.available)
            .map((item) => (
              <button
                type="button"
                key={`route:${item.extensionId}:${item.contribution.id}`}
                className={`hf-nav-button ${page === "extensions" && focusExtensionId === item.extensionId ? "active" : ""}`}
                onClick={() => {
                  setFocusExtensionId(item.extensionId);
                  navigate("extensions");
                }}
              >
                <span aria-hidden="true">◈</span>
                {item.contribution.name}
              </button>
            ))}
          {contributions.navigation.some((item) => item.available) && (
            <p className="hf-eyebrow hf-utility-nav-title">ADMIN UTILITIES</p>
          )}
          {contributions.navigation
            .filter((item) => item.available)
            .map((item) => (
              <button
                className={`hf-nav-button ${page === "utility" && utilityWorkspaceId === item.contribution.id ? "active" : ""}`}
                type="button"
                key={item.contribution.id}
                title={item.contribution.description}
                onClick={() => openUtility(item.contribution.componentId)}
              >
                <span aria-hidden="true">
                  {
                    {
                      cloud: "☁",
                      search: "⌕",
                      table: "▤",
                      database: "▥",
                      activity: "⌁",
                      "external-link": "↗",
                      star: "☆",
                      key: "◇",
                      users: "♙",
                    }[item.contribution.icon]
                  }
                </span>
                {item.contribution.name}
              </button>
            ))}
        </nav>
        <div className="hf-sidebar-bottom">
          <p>
            <span className="hf-local-dot" />
            Local runtime
          </p>
          <small>
            No Headful account required.
            <br />
            Salesforce CLI owns authentication.
          </small>
          {enabled("internal-chat") && (
            <button
              className="hf-button"
              type="button"
              onClick={() => {
                const chatUrl = new URL(location.href);
                chatUrl.searchParams.set("headfulChat", "1");
                chatUrl.hash = "/";
                location.assign(chatUrl.href);
              }}
            >
              Open experimental chat ↗
            </button>
          )}
        </div>
      </aside>
      <div className="hf-main">
        <header className="hf-topbar">
          <span>
            {page === "workspace" || page === "utility"
              ? "Explicit workspace target"
              : "Default for new work"}
          </span>
          <div>
            {(page === "workspace" || page === "utility" ? workspaceOrg : current) ? (
              <span className="hf-context">
                <i
                  style={{
                    background: (page === "workspace" || page === "utility"
                      ? workspaceOrg
                      : current
                    )?.color,
                  }}
                />
                {(page === "workspace" || page === "utility" ? workspaceOrg : current)?.label}
                <small>
                  {orgEnvironment(
                    (page === "workspace" || page === "utility" ? workspaceOrg : current)!,
                  )}
                </small>
              </span>
            ) : (
              <span className="hf-muted">
                {page === "workspace" || page === "utility"
                  ? "Choose a workspace target"
                  : "No default org"}
              </span>
            )}
            <button
              className="hf-icon-button"
              aria-label="Refresh local state"
              disabled={isDisabled}
              type="button"
              onClick={() => void action("Refreshing local state", refresh)}
            >
              ↻
            </button>
          </div>
        </header>
        <main
          className={`hf-content ${page === "workspace" || page === "utility" ? "hf-content-workspace" : ""}`}
        >
          {error && (
            <div className="hf-alert" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="hf-notice" role="status">
              {notice}
            </div>
          )}
          {busy && (
            <div className="hf-progress" role="status">
              {busy}…
            </div>
          )}
          {page !== "workspace" && page !== "utility" && (
            <div className="hf-page-heading">
              <div>
                <h1>{labels[page]}</h1>
              </div>
              {page === "orgs" && (
                <button
                  className="hf-button hf-primary"
                  type="button"
                  disabled={isDisabled || !cli?.selected || !enabled("org-management")}
                  onClick={() => {
                    setLoginEnvironment("production");
                    setConnect(true);
                  }}
                >
                  + Connect an org
                </button>
              )}
            </div>
          )}
          {page === "orgs" && (
            <>
              {status && !status.onboardingComplete && (
                <section className="hf-onboarding">
                  <div>
                    <p className="hf-eyebrow">WELCOME ABOARD</p>
                    <h2>Start with a little headspace.</h2>
                    <p>Manage Salesforce on your Mac. Bring an agent when you want one.</p>
                  </div>
                  <div className="hf-mode-grid">
                    <article className="hf-mode selected">
                      <span className="hf-badge">DEFAULT</span>
                      <h3>Minimal</h3>
                      <p>
                        Org manager, Salesforce workspace, and local MCP. No AI provider required.
                      </p>
                      <button
                        className="hf-button hf-primary"
                        type="button"
                        disabled={isDisabled}
                        onClick={() =>
                          void action("Saving your experience", async () => {
                            await dispatch("onboarding.complete", { mode: "minimal" });
                            await refresh();
                            setNotice(
                              "Minimal is ready. Set up Salesforce CLI and choose your orgs below.",
                            );
                          })
                        }
                      >
                        Use Minimal
                      </button>
                    </article>
                    <article className="hf-mode">
                      <span className="hf-badge">COMING SOON</span>
                      <h3>Power User</h3>
                      <p>
                        Broader internal agents, sessions, and orchestration. Working internal chat
                        can be enabled experimentally in Settings.
                      </p>
                    </article>
                  </div>
                </section>
              )}
              {(!cli?.selected || !status?.orgs.length) && cliPanel}
              <section className="hf-card">
                <div className="hf-card-heading">
                  <div>
                    <h2>Your connections</h2>
                    <p>
                      Choose which CLI connections belong in Headful. Import never grants agent
                      access automatically.
                    </p>
                  </div>
                  <button
                    className="hf-button"
                    disabled={isDisabled || !cli?.selected || !enabled("org-management")}
                    type="button"
                    onClick={() =>
                      void action("Discovering CLI orgs", async () => {
                        setDiscovered(
                          discoveredSchema.parse(await dispatch("orgs.discover")).connections,
                        );
                        setSelectedImports([]);
                      })
                    }
                  >
                    Import from CLI
                  </button>
                </div>
                {!status?.orgs.length ? (
                  <div className="hf-empty">
                    <span aria-hidden="true">☁</span>
                    <h3>Your next org starts here.</h3>
                    <p>
                      Connect through Salesforce’s browser login or select existing CLI connections.
                      Production and sandbox logins stay separate.
                    </p>
                  </div>
                ) : (
                  <div className="hf-org-grid">
                    {status.orgs.map((org) => (
                      <article className="hf-org-card" key={org.id}>
                        <div className="hf-org-heading">
                          <span className="hf-org-helmet" style={{ background: org.color }}>
                            <img src={helmet} alt="" />
                          </span>
                          <div>
                            <h3>{org.label}</h3>
                            <small>{org.alias || org.username}</small>
                          </div>
                          {org.isDefault && <span className="hf-badge">Default</span>}
                        </div>
                        <div className="hf-org-meta">
                          <span>
                            {org.isSandbox === null
                              ? "Environment unknown"
                              : org.isSandbox
                                ? "Sandbox"
                                : "Production"}
                          </span>
                          <span
                            className={
                              org.status === "connected" ? "hf-good-text" : "hf-warning-text"
                            }
                          >
                            {org.status.replaceAll("-", " ")}
                          </span>
                        </div>
                        <p className="hf-org-principal">{org.username}</p>
                        <details className="hf-org-identity">
                          <summary>Verified connection identity</summary>
                          <dl>
                            <div>
                              <dt>Salesforce org</dt>
                              <dd>{org.salesforceOrgId}</dd>
                            </div>
                            <div>
                              <dt>Principal</dt>
                              <dd>{org.principalId}</dd>
                            </div>
                            <div>
                              <dt>Instance</dt>
                              <dd>{org.instanceOrigin}</dd>
                            </div>
                          </dl>
                        </details>
                        <label className="hf-switch">
                          <input
                            type="checkbox"
                            checked={org.agentEnabled}
                            disabled={isDisabled}
                            onChange={(event) =>
                              void action("Saving agent access", async () => {
                                await dispatch("orgs.update", {
                                  orgId: org.id,
                                  agentEnabled: event.target.checked,
                                });
                                await refresh();
                              })
                            }
                          />
                          <span>Available to granted agents</span>
                        </label>
                        <label className="hf-switch">
                          <input
                            type="checkbox"
                            checked={org.remoteEnabled}
                            disabled={isDisabled}
                            onChange={(event) => {
                              const remoteEnabled = event.target.checked;
                              void action("Saving remote org access", async () => {
                                await dispatch("orgs.update", { orgId: org.id, remoteEnabled });
                                await refresh();
                              });
                            }}
                          />
                          <span>Allow Headful Connect grants for this org</span>
                        </label>
                        <div className="hf-org-actions">
                          <button
                            className="hf-button hf-primary"
                            disabled={isDisabled || !enabled("salesforce-workspace")}
                            type="button"
                            onClick={() => openWorkspace(org)}
                          >
                            Workspace
                          </button>
                          <button
                            className="hf-button"
                            disabled={isDisabled}
                            type="button"
                            onClick={() =>
                              void action("Opening Salesforce", async () => {
                                await dispatch("orgs.open", { orgId: org.id });
                              })
                            }
                          >
                            Salesforce ↗
                          </button>
                          <button
                            className="hf-button"
                            disabled={isDisabled || org.isDefault}
                            type="button"
                            onClick={() =>
                              void action("Changing the default", async () => {
                                await dispatch("orgs.default", { orgId: org.id });
                                await refresh();
                                setNotice(
                                  "Default updated for new contexts. Saved work keeps its original org.",
                                );
                              })
                            }
                          >
                            Set default
                          </button>
                          <button
                            className="hf-button"
                            disabled={isDisabled}
                            type="button"
                            onClick={() => setEditOrg(org)}
                          >
                            Edit
                          </button>
                        </div>
                        <details className="hf-advanced">
                          <summary>Connection actions</summary>
                          <div className="hf-org-actions">
                            <button
                              className="hf-button"
                              disabled={isDisabled}
                              type="button"
                              onClick={() =>
                                void action("Checking connection health", async () => {
                                  await dispatch("orgs.health", { orgId: org.id });
                                  await refresh();
                                })
                              }
                            >
                              Check health
                            </button>
                            {!org.isSandbox && (
                              <button
                                className="hf-button"
                                disabled={isDisabled}
                                type="button"
                                onClick={() =>
                                  void action("Reading visible sandboxes", async () => {
                                    const data = await dispatch("orgs.sandboxes", {
                                      orgId: org.id,
                                    });
                                    setSandboxes({ org, data: sandboxSchema.parse(data) });
                                  })
                                }
                              >
                                Visible sandboxes
                              </button>
                            )}
                            <button
                              className="hf-button"
                              disabled={isDisabled}
                              type="button"
                              onClick={() => {
                                setLoginEnvironment(org.isSandbox ? "sandbox" : "production");
                                setConnect(true);
                              }}
                            >
                              Reconnect via login
                            </button>
                            <button
                              className="hf-button"
                              disabled={isDisabled}
                              type="button"
                              onClick={() => setDanger({ org, kind: "remove" })}
                            >
                              Remove from Headful
                            </button>
                            <button
                              className="hf-button hf-danger"
                              disabled={isDisabled}
                              type="button"
                              onClick={() => setDanger({ org, kind: "logout" })}
                            >
                              Log out of Salesforce CLI
                            </button>
                          </div>
                        </details>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
          {page === "workspace" &&
            (enabled("salesforce-workspace") ? (
              <HeadfulWorkspaceShell
                title="Salesforce workspace"
                context={utilityContext}
                contributions={contributions}
                commands={workspaceCommands}
                native
                pinned={Boolean(workspaceLocation.workflowId || workspaceLocation.proposalId)}
                compact={extensionSettings["admin-utilities"]?.["compact-results"] !== false}
              >
                <Workspace
                  key={`${workspaceLocation.orgId || "none"}:${workspaceLocation.workflowId || "none"}:${workspaceLocation.proposalId || "none"}`}
                  initial={{
                    ...workspaceLocation,
                    ...(!workspaceLocation.orgId && workspaceOrgId
                      ? { orgId: workspaceOrgId }
                      : {}),
                  }}
                  onNavigate={onWorkspaceNavigate}
                  onInspectRecord={
                    contributions.navigation.some(
                      (item) =>
                        item.available &&
                        item.contribution.componentId === "admin-utilities/record-inspector",
                    )
                      ? (input) => openUtility("admin-utilities/record-inspector", input)
                      : undefined
                  }
                />
              </HeadfulWorkspaceShell>
            ) : (
              <div className="hf-empty">
                <h2>Salesforce workspace is disabled.</h2>
                <p>Enable it in Settings to inspect org records and workflows.</p>
              </div>
            ))}
          {page === "utility" && (
            <HeadfulWorkspaceShell
              title={utilityNavigation?.contribution.name || "Admin utility"}
              context={utilityContext}
              contributions={contributions}
              commands={workspaceCommands}
              compact={
                extensionSettings[utilityNavigation?.extensionId || ""]?.["compact-results"] !==
                false
              }
            >
              {!utilityNavigation?.available ? (
                <div className="hf-empty">
                  <h2>This contribution is unavailable.</h2>
                  <p>
                    {utilityNavigation?.unavailableReason ||
                      "The installed extension no longer declares this workspace."}
                  </p>
                  <button
                    className="hf-button"
                    type="button"
                    onClick={() => navigate("extensions")}
                  >
                    Manage extensions
                  </button>
                </div>
              ) : utilityNavigation.contribution.requiresOrg && !workspaceOrg ? (
                <div className="hf-empty">
                  <h2>Choose a connected target org.</h2>
                  <p>
                    The previous target is not an available connection. Use the org selector above
                    or connect it from Your orgs.
                  </p>
                </div>
              ) : (
                (() => {
                  const panels = contributions.panels.filter(
                    (item) =>
                      item.available &&
                      (item.contribution.workspaceIds.includes(workspaceId) ||
                        (item.contribution.workspaceIds.length === 0 &&
                          item.contribution.componentId ===
                            utilityNavigation.contribution.componentId)),
                  );
                  const components = [
                    ...new Set(
                      panels.length
                        ? panels.map((item) => item.contribution.componentId)
                        : [utilityNavigation.contribution.componentId],
                    ),
                  ];
                  return components.map((id) => {
                    const Component = adminUtilityComponents[id];
                    return Component ? (
                      <Component key={`${id}:${workspaceOrgId}`} {...utilityContext} />
                    ) : (
                      <div className="hf-empty" key={id}>
                        <h2>Panel unavailable in this build.</h2>
                        <p>
                          The manifest declares {id}, but its reviewed React component is not
                          registered.
                        </p>
                      </div>
                    );
                  });
                })()
              )}
            </HeadfulWorkspaceShell>
          )}
          {page === "integrations" && (
            <Integrations status={status} busy={isDisabled} action={action} />
          )}
          {page === "activity" && (
            <Activity status={status} onOpen={(location) => navigate("workspace", location)} />
          )}
          {page === "extensions" && (
            <HeadfulExtensions
              busy={isDisabled}
              action={action}
              onChanged={refresh}
              onSettings={() => navigate("settings")}
              focusExtensionId={focusExtensionId}
            />
          )}
          {page === "settings" && (
            <>
              <section className="hf-card">
                <div className="hf-card-heading">
                  <div>
                    <h2>Extensions</h2>
                    <p>
                      Inspect installed modules, their licenses and contributions, and enable or
                      disable them. Headful’s core Salesforce services remain in the desktop.
                    </p>
                  </div>
                  <button
                    className="hf-button"
                    type="button"
                    onClick={() => navigate("extensions")}
                  >
                    Manage extensions
                  </button>
                </div>
              </section>
              <section className="hf-card">
                <div className="hf-card-heading">
                  <div>
                    <h2>Your features</h2>
                    <p>
                      One configuration controls the workspace, menu bar, and agent capabilities.
                      Disabling a feature blocks its actions.
                    </p>
                  </div>
                  <span className="hf-badge">{status?.mode || "Minimal"}</span>
                </div>
                <div className="hf-feature-list">
                  {status?.features.map((feature) => (
                    <label className="hf-feature" key={feature.id}>
                      <span>
                        <strong>
                          {feature.name}{" "}
                          {feature.availability !== "available" && (
                            <small className="hf-badge">{feature.availability}</small>
                          )}
                        </strong>
                        <span>{feature.description}</span>
                        {feature.dependencies.length > 0 && (
                          <small>Requires: {feature.dependencies.join(", ")}</small>
                        )}
                      </span>
                      <input
                        aria-label={feature.name}
                        type="checkbox"
                        checked={feature.enabled}
                        disabled={isDisabled || feature.availability === "coming-soon"}
                        onChange={(event) => setFeature(feature.id, event.target.checked)}
                      />
                    </label>
                  ))}
                </div>
              </section>
              <section className="hf-card">
                <h2>Appearance</h2>
                <p>Keep the Headful palette in light and dark surroundings.</p>
                <div className="hf-segment" role="group" aria-label="Appearance">
                  {["system", "light", "dark"].map((value) => (
                    <button
                      className={`hf-button ${theme === value ? "hf-primary" : ""}`}
                      type="button"
                      aria-pressed={theme === value}
                      key={value}
                      onClick={() => setTheme(value)}
                    >
                      {value[0]?.toUpperCase()}
                      {value.slice(1)}
                    </button>
                  ))}
                </div>
              </section>
              {cliPanel}
              <section className="hf-card">
                <div className="hf-card-heading">
                  <div>
                    <h2>About Headful</h2>
                    <p>A local-first CRM agent orchestrator, built on T3 Code.</p>
                  </div>
                  <button
                    className="hf-button"
                    disabled={isDisabled}
                    type="button"
                    onClick={() =>
                      void action("Reading build information", async () =>
                        setAbout(aboutSchema.parse(await dispatch("system.about"))),
                      )
                    }
                  >
                    Build details
                  </button>
                </div>
                {about && (
                  <dl className="hf-about">
                    <div>
                      <dt>Headful</dt>
                      <dd>
                        {about.version} · {about.architecture} ·{" "}
                        {about.packaged ? "Packaged" : "Development"}
                      </dd>
                    </div>
                    <div>
                      <dt>T3 Code upstream</dt>
                      <dd>
                        {about.upstreamVersion} · {about.upstreamCommit.slice(0, 12)}
                      </dd>
                    </div>
                    <div>
                      <dt>Protocol</dt>
                      <dd>{about.protocolVersion}</dd>
                    </div>
                    {about.buildCommit && (
                      <div>
                        <dt>Build commit</dt>
                        <dd>{about.buildCommit}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Updates</dt>
                      <dd>{about.updates}</dd>
                    </div>
                  </dl>
                )}
                <p className="hf-note">
                  Free Mac early access. Power User orchestration and a mobile companion are future
                  scope. Core Salesforce credentials and CRM data are not routed through Headful
                  servers. Selected results may reach your chosen AI provider.
                </p>
              </section>
            </>
          )}
        </main>
      </div>
      {connect && (
        <ConnectModal
          error={error}
          initialEnvironment={loginEnvironment}
          busy={isDisabled}
          close={() => setConnect(false)}
          submit={(input) =>
            void action("Waiting for Salesforce browser login", async () => {
              await dispatch("orgs.login", input);
              setConnect(false);
              await refresh();
              setNotice(
                "Connected through Salesforce CLI. Agent access starts disabled until you choose it.",
              );
            })
          }
        />
      )}
      {discovered && (
        <Modal
          error={error}
          title="Choose CLI connections to import"
          onClose={() => setDiscovered(null)}
        >
          <p>
            Only selected connections are added. CLI keeps authentication; import verifies actual
            org and principal identity. Agent access starts off.
          </p>
          <div className="hf-import-list">
            {discovered.length ? (
              discovered.map((connection) => (
                <label className="hf-import" key={connection.username}>
                  <input
                    type="checkbox"
                    checked={selectedImports.includes(connection.username)}
                    disabled={isDisabled}
                    onChange={(event) =>
                      setSelectedImports((values) =>
                        event.target.checked
                          ? [...values, connection.username]
                          : values.filter((value) => value !== connection.username),
                      )
                    }
                  />
                  <span>
                    <strong>{connection.alias || connection.username}</strong>
                    <small>
                      {connection.username} · {connection.environment}
                      {connection.expirationDate ? ` · expires ${connection.expirationDate}` : ""}
                    </small>
                  </span>
                </label>
              ))
            ) : (
              <p>No CLI connections found. Connect an org through browser login.</p>
            )}
          </div>
          <div className="hf-actions">
            <button className="hf-button" type="button" onClick={() => setDiscovered(null)}>
              Cancel
            </button>
            <button
              className="hf-button hf-primary"
              type="button"
              disabled={isDisabled || !selectedImports.length}
              onClick={() =>
                void action("Importing selected connections", async () => {
                  for (const username of selectedImports)
                    await dispatch("orgs.import", { username });
                  setDiscovered(null);
                  await refresh();
                })
              }
            >
              Import {selectedImports.length || "selected"}
            </button>
          </div>
        </Modal>
      )}
      {editOrg && (
        <EditOrgModal
          error={error}
          org={editOrg}
          busy={isDisabled}
          close={() => setEditOrg(null)}
          submit={(input) =>
            void action("Saving org details", async () => {
              await dispatch("orgs.update", input);
              setEditOrg(null);
              await refresh();
            })
          }
        />
      )}
      {danger && (
        <Modal
          error={error}
          title={
            danger.kind === "logout"
              ? "Log this org out of Salesforce CLI?"
              : "Remove this connection from Headful?"
          }
          onClose={() => setDanger(null)}
        >
          <p>
            <strong>{danger.org.label}</strong>
            <br />
            {danger.org.username}
          </p>
          <p>
            {danger.kind === "logout"
              ? "This explicitly removes the Salesforce CLI authentication used by other tools as well as Headful’s reference. It does not undo Salesforce changes. You will need to log in again."
              : "This removes Headful’s reference and access to the connection. Salesforce CLI remains authenticated for other tools. Saved workflow history remains, but cannot execute through a removed connection."}
          </p>
          <div className="hf-actions">
            <button
              className="hf-button"
              type="button"
              disabled={isDisabled}
              onClick={() => setDanger(null)}
            >
              Keep connection
            </button>
            <button
              className="hf-button hf-danger"
              type="button"
              disabled={isDisabled}
              onClick={() =>
                void action(
                  danger.kind === "logout" ? "Logging out of CLI" : "Removing Headful reference",
                  async () => {
                    await dispatch(`orgs.${danger.kind}`, {
                      orgId: danger.org.id,
                      ...(danger.kind === "logout" ? { confirmLogout: true } : {}),
                    });
                    setDanger(null);
                    await refresh();
                  },
                )
              }
            >
              {danger.kind === "logout" ? "Log out of CLI" : "Remove from Headful"}
            </button>
          </div>
        </Modal>
      )}
      {sandboxes && (
        <Modal
          title={`Sandboxes visible from ${sandboxes.org.label}`}
          onClose={() => setSandboxes(null)}
        >
          <p>
            Inventory is limited by Salesforce privileges. A visible sandbox is not authenticated;
            connect it separately.
          </p>
          <div className="hf-import-list">
            {sandboxes.data.sandboxes.length ? (
              sandboxes.data.sandboxes.map((sandbox) => (
                <article className="hf-import" key={sandbox.Id}>
                  <span>
                    <strong>{sandbox.SandboxName}</strong>
                    <small>{sandbox.LicenseType || "Sandbox"} · Separate login required</small>
                    {sandbox.Description && <small>{sandbox.Description}</small>}
                  </span>
                </article>
              ))
            ) : (
              <p>
                {sandboxes.data.message ||
                  "No sandbox inventory is visible to this connection. You can connect a known sandbox separately."}
              </p>
            )}
          </div>
          <div className="hf-actions">
            <button
              className="hf-button hf-primary"
              type="button"
              onClick={() => {
                setSandboxes(null);
                setLoginEnvironment("sandbox");
                setConnect(true);
              }}
            >
              Connect a sandbox
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ConnectModal({
  busy,
  close,
  submit,
  error,
  initialEnvironment,
}: {
  error: string;
  initialEnvironment: "production" | "sandbox" | "my-domain";
  busy: boolean;
  close: () => void;
  submit: (input: {
    environment: "production" | "sandbox" | "my-domain";
    alias?: string;
    instanceOrigin?: string;
  }) => void;
}) {
  const [environment, setEnvironment] = useState<"production" | "sandbox" | "my-domain">(
    initialEnvironment,
  );
  const [alias, setAlias] = useState("");
  const [origin, setOrigin] = useState("");
  const login = (event: FormEvent) => {
    event.preventDefault();
    submit({
      environment,
      ...(alias ? { alias } : {}),
      ...(environment === "my-domain" ? { instanceOrigin: origin } : {}),
    });
  };
  return (
    <Modal error={error} title="Connect a Salesforce org" onClose={close}>
      <p>
        Salesforce CLI opens Salesforce’s browser login, including SSO and MFA. Your org’s
        authorization policy still applies.
      </p>
      <form onSubmit={login}>
        <label className="hf-field">
          Environment
          <select
            value={environment}
            disabled={busy}
            onChange={(event) =>
              setEnvironment(
                z.enum(["production", "sandbox", "my-domain"]).parse(event.target.value),
              )
            }
          >
            <option value="production">Production</option>
            <option value="sandbox">Sandbox</option>
            <option value="my-domain">My Domain / SSO</option>
          </select>
        </label>
        {environment === "my-domain" && (
          <label className="hf-field">
            Salesforce My Domain address
            <input
              type="url"
              value={origin}
              required
              placeholder="https://example.my.salesforce.com"
              onChange={(event) => setOrigin(event.target.value)}
              disabled={busy}
            />
          </label>
        )}
        <label className="hf-field">
          CLI alias <small>Optional; starts with a letter</small>
          <input
            value={alias}
            maxLength={80}
            pattern="[A-Za-z][A-Za-z0-9_-]{0,79}"
            placeholder="northstar-qa"
            onChange={(event) => setAlias(event.target.value)}
            disabled={busy}
          />
        </label>
        <p className="hf-note">
          Headful’s default does not change Salesforce CLI’s global default. Newly connected orgs
          are not exposed automatically to agents.
        </p>
        <div className="hf-actions">
          <button className="hf-button" type="button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="hf-button hf-primary" disabled={busy}>
            {busy ? "Waiting for Salesforce…" : "Open Salesforce login ↗"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function EditOrgModal({
  org,
  busy,
  close,
  submit,
  error,
}: {
  error: string;
  org: Org;
  busy: boolean;
  close: () => void;
  submit: (input: { orgId: string; label: string; alias: string; color: string }) => void;
}) {
  const [label, setLabel] = useState(org.label);
  const [alias, setAlias] = useState(org.alias);
  const [color, setColor] = useState(org.color);
  return (
    <Modal error={error} title="Recognize this org at a glance" onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit({ orgId: org.id, label, alias, color });
        }}
      >
        <label className="hf-field">
          Display name
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
            maxLength={80}
            disabled={busy}
          />
        </label>
        <label className="hf-field">
          Headful alias
          <input
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            maxLength={80}
            disabled={busy}
          />
        </label>
        <label className="hf-field">
          Helmet color
          <input
            className="hf-color-input"
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            disabled={busy}
          />
        </label>
        <p className="hf-note">
          These are Headful display preferences. Verified org and principal identity remain
          authoritative; other CLI tools keep their own aliases.
        </p>
        <div className="hf-actions">
          <button className="hf-button" type="button" onClick={close}>
            Cancel
          </button>
          <button className="hf-button hf-primary" disabled={busy}>
            Save org
          </button>
        </div>
      </form>
    </Modal>
  );
}

const grantSchema = z.object({
  id: identifier,
  label: z.string(),
  orgIds: z.array(z.string()),
  scopes: z.array(z.string()),
  createdAt: z.number(),
  revokedAt: z.number().nullable(),
  lastSeenAt: z.number().nullable().optional(),
});
const grantListSchema = z.object({ grants: z.array(grantSchema) });
const harnessStatusSchema = z.object({
  clients: z.array(
    z.object({ client: z.string(), file: z.string(), configured: z.boolean(), local: z.boolean() }),
  ),
});
const clients = [
  { id: "codex", name: "Codex" },
  { id: "claude-desktop", name: "Claude Desktop" },
  { id: "claude-code", name: "Claude Code" },
  { id: "opencode", name: "OpenCode" },
  { id: "generic", name: "Generic local MCP" },
];
function Integrations({
  status,
  busy,
  action,
}: {
  status: Status | null;
  busy: boolean;
  action: (label: string, run: () => Promise<void>) => Promise<void>;
}) {
  const [grants, setGrants] = useState<z.infer<typeof grantSchema>[]>([]);
  const [harnesses, setHarnesses] = useState<z.infer<typeof harnessStatusSchema>["clients"]>([]);
  const [label, setLabel] = useState("");
  const [orgIds, setOrgIds] = useState<string[]>([]);
  const [propose, setPropose] = useState(false);
  const [client, setClient] = useState("codex");
  const [selectedGrant, setSelectedGrant] = useState("");
  const [result, setResult] = useState("");
  const enabledOrgs = status?.orgs.filter((org) => org.agentEnabled) || [];
  const load = useCallback(async () => {
    setGrants(grantListSchema.parse(await dispatch("grants.list")).grants);
    setHarnesses(harnessStatusSchema.parse(await dispatch("harness.status")).clients);
  }, []);
  useEffect(() => {
    void action("Reading local agent connections", load);
  }, [action, load]);
  const mcpEnabled = status?.features.find((feature) => feature.id === "local-mcp")?.enabled;
  return (
    <>
      <section className="hf-card">
        <div className="hf-card-heading">
          <div>
            <h2>Local MCP</h2>
            <p>
              The installed app owns one runtime. Clients use its packaged bridge, with locally
              bundled interactive Apps and text fallbacks.
            </p>
          </div>
          <span className="hf-badge">{mcpEnabled ? "Enabled" : "Disabled"}</span>
        </div>
        <p className="hf-notice">
          Hosted ChatGPT connectors cannot reach your Mac’s loopback server directly. Use a
          supported local desktop or CLI integration. Interactive App rendering depends on the host.
        </p>
      </section>
      <section className="hf-card">
        <h2>Grant a local client access</h2>
        <p>
          Only enabled orgs you select are visible to this client. Read access does not approve
          writes.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void action("Creating local client grant", async () => {
              const created = z.object({ grant: grantSchema }).parse(
                await dispatch("grants.create", {
                  label,
                  orgIds,
                  scopes: [
                    "headful:read",
                    ...(propose
                      ? [
                          "headful:propose",
                          "headful:users",
                          "headful:access",
                          "headful:permissions",
                        ]
                      : []),
                  ],
                }),
              );
              setSelectedGrant(created.grant.id);
              setLabel("");
              await load();
            });
          }}
        >
          <label className="hf-field">
            Connection name
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              required
              maxLength={100}
              placeholder="My Claude Desktop"
              disabled={busy || !mcpEnabled}
            />
          </label>
          <div className="hf-import-list">
            {enabledOrgs.length ? (
              enabledOrgs.map((org) => (
                <label className="hf-import" key={org.id}>
                  <input
                    type="checkbox"
                    checked={orgIds.includes(org.id)}
                    disabled={busy || !mcpEnabled}
                    onChange={(event) =>
                      setOrgIds((values) =>
                        event.target.checked
                          ? [...values, org.id]
                          : values.filter((value) => value !== org.id),
                      )
                    }
                  />
                  <span>
                    <strong>{org.label}</strong>
                    <small>
                      {org.isSandbox ? "Sandbox" : "Production"} · {org.username}
                    </small>
                  </span>
                </label>
              ))
            ) : (
              <p>Enable agent access on an org before granting it to a client.</p>
            )}
          </div>
          <label className="hf-switch">
            <input
              type="checkbox"
              checked={propose}
              onChange={(event) => setPropose(event.target.checked)}
              disabled={busy || !mcpEnabled}
            />
            <span>
              Allow supported admin proposals and workflow inspection; execution still needs exact
              human review.
            </span>
          </label>
          <button className="hf-button hf-primary" disabled={busy || !mcpEnabled || !orgIds.length}>
            Create local grant
          </button>
        </form>
      </section>
      <section className="hf-card">
        <h2>Connect your harness</h2>
        <p>
          Headful preserves unrelated settings, backs up the file, and changes only its own entry.
          Preview before installation.
        </p>
        <div className="hf-two-fields">
          <label className="hf-field">
            Harness
            <select
              value={client}
              onChange={(event) => setClient(event.target.value)}
              disabled={busy}
            >
              {clients.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="hf-field">
            Local grant
            <select
              value={selectedGrant}
              onChange={(event) => setSelectedGrant(event.target.value)}
              disabled={busy}
            >
              <option value="">Choose a grant</option>
              {grants
                .filter((grant) => grant.revokedAt === null)
                .map((grant) => (
                  <option key={grant.id} value={grant.id}>
                    {grant.label}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="hf-actions">
          <button
            className="hf-button"
            disabled={busy || !selectedGrant}
            type="button"
            onClick={() =>
              void action("Previewing harness configuration", async () => {
                const preview = await dispatch("harness.preview", {
                  client,
                  grantId: selectedGrant,
                });
                setResult(JSON.stringify(preview, null, 2));
              })
            }
          >
            Preview configuration
          </button>
          <button
            className="hf-button hf-primary"
            disabled={busy || !selectedGrant}
            type="button"
            onClick={() =>
              void action("Installing Headful connection", async () => {
                const installed = await dispatch("harness.configure", {
                  client,
                  grantId: selectedGrant,
                });
                setResult(JSON.stringify(installed, null, 2));
                await load();
              })
            }
          >
            Install connection
          </button>
        </div>
        {result && <pre className="hf-bounded-json">{result}</pre>}
        <div className="hf-harness-list">
          {harnesses
            .filter((harness) => harness.configured)
            .map((harness) => (
              <article key={harness.client}>
                <div>
                  <strong>
                    {clients.find((item) => item.id === harness.client)?.name || harness.client}
                  </strong>
                  <code>{harness.file}</code>
                </div>
                <button
                  className="hf-button"
                  disabled={busy}
                  type="button"
                  onClick={() =>
                    void action("Removing harness configuration", async () => {
                      await dispatch("harness.remove", { client: harness.client });
                      await load();
                    })
                  }
                >
                  Uninstall entry
                </button>
              </article>
            ))}
        </div>
      </section>
      <section className="hf-card">
        <div className="hf-card-heading">
          <h2>Client grants</h2>
          <button
            className="hf-button"
            disabled={busy}
            type="button"
            onClick={() => void action("Refreshing grants", load)}
          >
            Refresh
          </button>
        </div>
        {grants.length ? (
          <div className="hf-grant-list">
            {grants.map((grant) => (
              <article key={grant.id}>
                <div>
                  <strong>{grant.label}</strong>
                  <small>
                    {grant.revokedAt
                      ? "Revoked"
                      : `${grant.orgIds.length} orgs · ${grant.scopes.includes("headful:propose") ? "Reads and proposals" : "Read only"}`}
                  </small>
                  <small>
                    {grant.lastSeenAt
                      ? `Last connected ${new Date(grant.lastSeenAt).toLocaleString()}`
                      : "No connection observed in this runtime"}
                  </small>
                </div>
                <button
                  className="hf-button hf-danger"
                  disabled={busy || Boolean(grant.revokedAt)}
                  type="button"
                  onClick={() =>
                    void action("Revoking local grant", async () => {
                      await dispatch("grants.revoke", { grantId: grant.id });
                      await load();
                    })
                  }
                >
                  Revoke
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="hf-muted">
            No local grants yet. Salesforce credentials never appear in the client configuration.
          </p>
        )}
      </section>
    </>
  );
}
const activitySchema = z.object({
  activity: z
    .array(
      z.object({
        id: z.number(),
        kind: z.string(),
        org_id: z.string().nullable(),
        target_id: z.string().nullable(),
        created_at: z.number(),
      }),
    )
    .max(100),
  bounded: z.literal(true),
});
function Activity({
  status,
  onOpen,
}: {
  status: Status | null;
  onOpen: (location: WorkspaceLocation) => void;
}) {
  const [workflows, setWorkflows] = useState<z.infer<typeof listWorkflowsSchema>["workflows"]>([]);
  const [activity, setActivity] = useState<z.infer<typeof activitySchema>["activity"]>([]);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const refresh = useCallback(async () => {
    setReading(true);
    setError("");
    try {
      const [saved, recorded] = await Promise.all([
        dispatch("listWorkflows"),
        dispatch("activity.list"),
      ]);
      setWorkflows(listWorkflowsSchema.parse(saved).workflows);
      setActivity(activitySchema.parse(recorded).activity);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setReading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <>
      <section className="hf-card">
        <div className="hf-card-heading">
          <div>
            <h2>Saved work and confirmed progress</h2>
            <p>
              Continue the same durable record. Completed user creation and verified access
              assignments stay saved after a later failure.
            </p>
          </div>
          <button
            className="hf-button"
            type="button"
            disabled={reading}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>
        {error && (
          <p className="hf-alert" role="alert">
            {error}
          </p>
        )}
        {workflows.length ? (
          <div className="hf-grant-list">
            {workflows.map((workflow) => (
              <article key={workflow.id}>
                <div>
                  <strong>
                    {workflow.createdUser
                      ? `${workflow.createdUser.FirstName || ""} ${workflow.createdUser.LastName}`
                      : "Create Salesforce user"}
                  </strong>
                  <small>
                    {workflow.setup.org.label} · Revision {workflow.revision} ·{" "}
                    {workflow.status.replaceAll("_", " ")}
                  </small>
                  <small>{new Date(workflow.updatedAt).toLocaleString()}</small>
                </div>
                <button
                  className="hf-button"
                  type="button"
                  onClick={() =>
                    onOpen({
                      view: workflow.createdUser ? "user" : "create-user",
                      orgId: workflow.orgId,
                      workflowId: workflow.id,
                      ...(workflow.recordId ? { recordId: workflow.recordId } : {}),
                    })
                  }
                >
                  Continue
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="hf-empty">
            <h3>Your next reviewed task will appear here.</h3>
            <p>
              Open the Salesforce workspace to prepare supported changes. A model tool call is never
              an approval.
            </p>
          </div>
        )}
      </section>
      <section className="hf-card">
        <h2>Local activity</h2>
        <p>
          Recent connection and reviewed-operation events. Open a permission review to inspect its
          retained outcome and provider readback.
        </p>
        {activity.length ? (
          <div className="hf-grant-list">
            {activity.map((event) => (
              <article key={event.id}>
                <div>
                  <strong>{event.kind.replaceAll("_", " ")}</strong>
                  <small>
                    {status?.orgs.find((org) => org.id === event.org_id)?.label ||
                      (event.org_id ? "Recorded org" : "Headful")}{" "}
                    · {new Date(event.created_at).toLocaleString()}
                  </small>
                </div>
                {event.kind.startsWith("permission_change_") && event.target_id && event.org_id && (
                  <button
                    className="hf-button"
                    type="button"
                    onClick={() =>
                      onOpen({
                        view: "review",
                        orgId: event.org_id || undefined,
                        proposalId: event.target_id || undefined,
                      })
                    }
                  >
                    Review / receipt
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="hf-muted">No local activity recorded yet.</p>
        )}
      </section>
    </>
  );
}
