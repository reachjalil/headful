/* oxlint-disable shadcn/no-unknown-classes -- Focused Headful admin workspace. */
import "../workspace-theme.css";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { modCommandResultSchema, type HeadfulModDescriptor } from "@t3tools/contracts/headful-mods";
import {
  adminUtilityComponents,
  preloadAdminUtility,
  LazySurface,
  PanelTabs,
  panelTabId,
  type UtilityComponentProps,
} from "@headfulcloud/admin-utilities/web";
import {
  headfulUtilityInputSchemas,
  headfulUtilityResultSchemas,
  type HeadfulUtilityOperation,
} from "@t3tools/contracts/headful-utilities";
import type { SetupDispatch } from "../setup-service";
import "../workspace-shell.css";
import "./admin-workspace.css";

import {
  adminTools,
  editorStep,
  resolveEditorContributions,
  type EditorAction,
} from "./editor-contributions";
import { ContributionIcon, EditorToolMenu } from "./EditorToolMenu";
import { EditorModView } from "./EditorModView";
import { createWorkspaceQueries, readWorkspaceMetadata } from "./WorkspaceQueries";
export { adminTools } from "./editor-contributions";
export type AdminTool = string;
type ToolInput = UtilityComponentProps["initialInput"];
const emptyToolState: { input: ToolInput } = { input: undefined };
type EditorHistory = { entries: string[]; index: number };
const historyLimit = 40;

function preloadTool(tool: {
  contribution: { componentId?: string | undefined };
  available: boolean;
}) {
  if (tool.available && tool.contribution.componentId)
    void preloadAdminUtility(tool.contribution.componentId)?.catch(() => {});
}

/** One org-pinned workspace. Visited tools stay mounted so changing tools preserves drafts. */
export function AdminWorkspace({
  org,
  dispatch,
  mods,
  features,
  initialTool = "schema",
  onStepChange,
  onManageMods,
  sidebarNavigation = false,
  navigationRequest,
}: {
  org: UtilityComponentProps["orgs"][number];
  dispatch: SetupDispatch;
  mods: readonly HeadfulModDescriptor[];
  features: readonly { id: string; enabled: boolean; configuredEnabled?: boolean }[];
  onManageMods?: (() => void) | undefined;
  sidebarNavigation?: boolean;
  navigationRequest?: { tool: string; revision: number } | undefined;
  initialTool?: AdminTool | undefined;
  onStepChange?: ((step: string) => void) | undefined;
}) {
  const orgId = org.id;
  const { tools, actions } = useMemo(
    () => resolveEditorContributions(mods, features, adminUtilityComponents),
    [mods, features],
  );
  const authority = JSON.stringify({
    org: [org.id, org.username, org.salesforceOrgId, org.status],
    mods: mods.map((mod) => [
      mod.manifest.id,
      mod.artifactRevision,
      mod.status,
      mod.enabled,
      mod.compatible,
      mod.grantedPermissions,
      mod.registeredCapabilities,
    ]),
    features: features.map((feature) => [feature.id, feature.enabled, feature.configuredEnabled]),
  });
  // A changed identity/access configuration creates a new, unpersisted cache without losing drafts.
  // oxlint-disable-next-line react/memo-dependencies -- Transport and authority are intentional cache invalidation keys, even though this factory takes no arguments.
  const queries = useMemo(() => createWorkspaceQueries(), [dispatch, authority]);
  useEffect(() => () => queries.clear(), [queries]);
  const orgs = useMemo(() => [org], [org]);
  const initialId =
    adminTools.find((item) => item.id === initialTool)?.contributionId ?? initialTool;
  const [history, setHistory] = useState<EditorHistory>(() => {
    const first =
      tools.find((item) => item.available && item.contribution.id === initialId) ??
      tools.find((item) => item.available);
    return { entries: first ? [first.key] : [], index: 0 };
  });
  const activeTool =
    tools.find((item) => item.key === history.entries[history.index] && item.available) ??
    tools.find((item) => item.available);
  const tabsId = useId();
  // Revoked/replaced contributions are skipped; history never resurrects an old artifact.
  const previous = history.entries.findLastIndex(
    (key, index) =>
      index < history.index && tools.some((item) => item.key === key && item.available),
  );
  const next = history.entries.findIndex(
    (key, index) =>
      index > history.index && tools.some((item) => item.key === key && item.available),
  );
  const tool = activeTool
    ? editorStep(activeTool.contribution.id, activeTool.contribution.componentId)
    : "unavailable";
  const [visited, setVisited] = useState<Record<string, { input: ToolInput }>>({});
  const [pending, setPending] = useState(0);
  const [feedback, setFeedback] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    onStepChange?.(tool);
  }, [tool, onStepChange]);
  const invoke = useCallback(
    async (operation: string, input: unknown) => {
      if (!Object.hasOwn(headfulUtilityInputSchemas, operation))
        throw new Error("This tool is unavailable.");
      const op = operation as HeadfulUtilityOperation;
      // Target comes from the pinned workspace, never a component's navigation payload.
      const supplied = typeof input === "object" && input !== null ? input : {};
      const parsed = headfulUtilityInputSchemas[op].parse({ ...supplied, orgId });
      setPending((value) => value + 1);
      try {
        return await readWorkspaceMetadata(queries, op, parsed, async () =>
          headfulUtilityResultSchemas[op].parse(await dispatch(op, parsed)),
        );
      } finally {
        if (alive.current) setPending((value) => Math.max(0, value - 1));
      }
    },
    // oxlint-disable-next-line react/memo-dependencies -- Keep target and transport explicit as dependencies as well as cache inputs.
    [dispatch, orgId, queries],
  );
  const navigate = useCallback(
    (component: string, input?: Record<string, string | number | boolean>) => {
      const next = tools.find(
        (item) =>
          item.available &&
          (item.contribution.componentId === component || item.contribution.id === component),
      );
      if (!next) return;
      if (input?.orgId && input.orgId !== orgId) {
        setFeedback("This item belongs to another org. Open that org’s workspace to use it.");
        return;
      }
      setHistory((current) => {
        const entries = [...current.entries];
        if (activeTool) entries[current.index] = activeTool.key;
        if (entries[current.index] === next.key) return { entries, index: current.index };
        const trail = [...entries.slice(0, current.index + 1), next.key].slice(-historyLimit);
        return { entries: trail, index: trail.length - 1 };
      });
      setVisited((current) => ({
        ...current,
        // Remember the outgoing initial tool before navigating away, including after metadata rechecks.
        ...(activeTool ? { [activeTool.key]: current[activeTool.key] ?? emptyToolState } : {}),
        [next.key]: input ? { input } : (current[next.key] ?? { input: undefined }),
      }));
      setFeedback("");
    },
    [tools, activeTool, orgId],
  );
  const handledNavigation = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!navigationRequest || handledNavigation.current === navigationRequest.revision) return;
    handledNavigation.current = navigationRequest.revision;
    const item = tools.find(
      (item) =>
        item.available &&
        editorStep(item.contribution.id, item.contribution.componentId) === navigationRequest.tool,
    );
    // oxlint-disable-next-line react/set-state-in-effect -- Consume an explicit parent navigation request once; retain this org’s mounted tool state.
    if (item) navigate(item.contribution.id);
  }, [navigationRequest, tools, navigate]);
  const moveHistory = (index: number) => {
    if (index < 0) return;
    setVisited((current) => ({
      ...current,
      ...(activeTool ? { [activeTool.key]: current[activeTool.key] ?? emptyToolState } : {}),
    }));
    setHistory((current) => ({ ...current, index }));
    setFeedback("");
  };
  const runAction = async (action: EditorAction) => {
    if (!action.available) return;
    if (action.needsConfiguration) {
      onManageMods?.();
      if (!onManageMods)
        setFeedback("Open Settings → Local mods to configure this command’s inputs.");
      return;
    }
    const input = action.command.parameters.some((parameter) => parameter.key === "org-id")
      ? { "org-id": org.id }
      : {};
    setPending((value) => value + 1);
    setFeedback("");
    try {
      const result = modCommandResultSchema.parse(
        await dispatch("mods.command", {
          id: action.modId,
          command: action.command.id,
          input,
          artifactRevision: action.revision,
        }),
      );
      if (alive.current)
        setFeedback(
          result.message +
            (result.values
              ? ` · ${Object.entries(result.values)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(" · ")}`
              : ""),
        );
    } catch (error) {
      if (alive.current)
        setFeedback(
          error instanceof Error
            ? error.message
            : "The mod action failed. Try again explicitly after checking its status.",
        );
    } finally {
      if (alive.current) setPending((value) => Math.max(0, value - 1));
    }
  };
  const contextualActions = actions.filter(
    (action) =>
      !action.contribution.workspaceIds.length ||
      action.contribution.workspaceIds.includes(activeTool?.contribution.id ?? ""),
  );
  const primaryActions = contextualActions
    .filter(
      (action) =>
        action.available &&
        !action.needsConfiguration &&
        action.contribution.placement === "primary",
    )
    .slice(0, 2);
  return (
    <QueryClientProvider client={queries}>
      <section
        className={`sf-admin ${sidebarNavigation ? "sf-admin-sidebar" : ""}`}
        data-experience="admin-workspace"
        data-experience-step={tool}
        aria-busy={pending > 0}
        aria-label={`${org.label} admin tools`}
      >
        <div className="sf-editor-toolbar">
          <div className="sf-editor-history" aria-label="Workspace history">
            <button
              type="button"
              data-testid="editor-back"
              aria-label="Back in workspace"
              disabled={previous < 0}
              onClick={() => moveHistory(previous)}
            >
              <ArrowLeft size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-testid="editor-forward"
              aria-label="Forward in workspace"
              disabled={next < 0}
              onClick={() => moveHistory(next)}
            >
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
          {!sidebarNavigation && (
            <nav className="sf-admin-nav" aria-label="Admin tools">
              <PanelTabs
                idPrefix={tabsId}
                label="Workspace tools"
                value={activeTool?.key ?? ""}
                items={tools
                  .filter(
                    (item) =>
                      item.pinned ||
                      (item.available && (visited[item.key] || item.key === activeTool?.key)),
                  )
                  .map((item) => ({
                    id: item.key,
                    label: item.contribution.name,
                    icon: <ContributionIcon name={item.contribution.icon} />,
                    disabled: !item.available,
                    testId: `admin-tool-${editorStep(item.contribution.id, item.contribution.componentId)}`,
                    panelId: `${tabsId}-panel-${encodeURIComponent(item.key)}`,
                  }))}
                onChange={(key) => {
                  const item = tools.find((tool) => tool.key === key && tool.available);
                  if (item) navigate(item.contribution.id);
                }}
                onIntent={(key) => {
                  const item = tools.find((tool) => tool.key === key);
                  if (item) preloadTool(item);
                }}
              />
            </nav>
          )}
          <div className="sf-editor-toolbar-actions">
            {primaryActions.map((action) => (
              <button
                className="hf-button"
                key={action.contribution.id}
                data-testid={`editor-action-${action.contribution.id}`}
                disabled={pending > 0}
                onClick={() => void runAction(action)}
              >
                <ContributionIcon name={action.contribution.icon} /> {action.contribution.name}
              </button>
            ))}
            <EditorToolMenu
              tools={tools}
              actions={contextualActions}
              activeId={activeTool?.contribution.id ?? ""}
              pending={pending > 0}
              onTool={navigate}
              onAction={(action) => void runAction(action)}
              onManageMods={onManageMods}
              onPreload={preloadTool}
            />
          </div>
        </div>
        {feedback && (
          <div className="sf-admin-feedback" role="status">
            {feedback}
            <button aria-label="Dismiss message" onClick={() => setFeedback("")}>
              ×
            </button>
          </div>
        )}
        {!activeTool && (
          <div className="sf-editor-unavailable">
            <h1>No editor tools available</h1>
            <p>Use Settings → Local mods to inspect permissions, status and enabled tools.</p>
            {onManageMods && (
              <button className="hf-button" onClick={onManageMods}>
                Manage local mods
              </button>
            )}
          </div>
        )}
        {tools
          .filter((item) => item.pinned || item.available)
          .map((item) => {
            const state = item.available
              ? (visited[item.key] ?? (activeTool?.key === item.key ? emptyToolState : undefined))
              : undefined;
            const Component = item.contribution.componentId
              ? adminUtilityComponents[item.contribution.componentId]
              : undefined;
            return (
              <div
                key={item.key}
                id={`${tabsId}-panel-${encodeURIComponent(item.key)}`}
                role="tabpanel"
                aria-labelledby={sidebarNavigation ? undefined : panelTabId(tabsId, item.key)}
                aria-label={sidebarNavigation ? item.contribution.name : undefined}
                hidden={!state || activeTool?.key !== item.key}
                data-testid={`admin-panel-${editorStep(item.contribution.id, item.contribution.componentId)}`}
              >
                {state && (
                  <LazySurface label={item.contribution.name}>
                    {Component ? (
                      <Component
                        orgId={org.id}
                        workspaceId={item.contribution.id}
                        orgs={orgs}
                        dispatch={invoke}
                        initialInput={state.input}
                        onNavigate={navigate}
                        onFeedback={setFeedback}
                        onOrgChange={ignoreOrgChange}
                      />
                    ) : (
                      <EditorModView tool={item} dispatch={dispatch} />
                    )}
                  </LazySurface>
                )}
              </div>
            );
          })}
      </section>
    </QueryClientProvider>
  );
}

const ignoreOrgChange = () => {};
