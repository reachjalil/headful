import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { headfulResultSchemas } from "@t3tools/contracts/headful";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { AppRouter } from "../router";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  chatOrgInstructions,
  chatPinsSchema,
  initializeChatPin,
  pinMatchesConnection,
  pinOrg,
  type ChatPins,
} from "./chat-context";
import helmet from "./helmet.svg";
import "./headful-chat.css";

const STORAGE_KEY = "headful.chat.org-context.v1";
type Status = ReturnType<typeof headfulResultSchemas.status.parse>;

function readPins(): ChatPins {
  try {
    return chatPinsSchema.parse(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}"));
  } catch {
    return {};
  }
}
function leaveChat(route: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete("headfulChat");
  url.hash = route;
  window.location.assign(url.href);
}

/** A metadata-only context bar over the retained provider/chat stack. Access stays in local grants. */
export function HeadfulChatContext({ router }: { router: AppRouter }) {
  const subscribe = useCallback(
    (listener: () => void) => router.subscribe("onResolved", listener),
    [router],
  );
  const pathname = useSyncExternalStore(subscribe, () => router.state.location.pathname);
  const target = useMemo(() => {
    const params: Partial<Record<"environmentId" | "threadId" | "draftId", string>> = {};
    for (const match of router.state.matches) {
      for (const [key, value] of Object.entries(match.params)) {
        if (
          (key === "environmentId" || key === "threadId" || key === "draftId") &&
          typeof value === "string"
        )
          params[key] = value;
      }
    }
    return resolveThreadRouteTarget(params);
  }, [pathname, router]);
  const draft = useComposerDraftStore((store) =>
    target?.kind === "draft" ? store.getDraftSession(target.draftId) : null,
  );
  const promotedDraftId = useComposerDraftStore((store) =>
    target?.kind === "server" ? store.getDraftIdByRef(target.threadRef) : null,
  );
  const identity = useMemo(() => {
    if (target?.kind === "server")
      return {
        key: `thread:${scopedThreadKey(target.threadRef)}`,
        aliases: promotedDraftId ? [`draft:${promotedDraftId}`] : [],
      };
    if (target?.kind === "draft")
      return {
        key: `draft:${target.draftId}`,
        aliases: draft ? [`thread:${scopedThreadKey(draft.promotedTo ?? draft)}`] : [],
      };
    return null;
  }, [target, draft, promotedDraftId]);
  const [status, setStatus] = useState<Status | null>(null);
  const [pins, setPins] = useState(readPins);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const refresh = useCallback(async () => {
    setPending(true);
    try {
      if (!window.headfulBridge) throw new Error("Headful's local runtime is unavailable.");
      setStatus(
        headfulResultSchemas.status.parse(await window.headfulBridge.dispatch("status", {})),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read Headful org metadata.");
    } finally {
      setPending(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const unsubscribe = window.headfulBridge?.onNavigate?.((route) => leaveChat(route));
    return () => {
      window.removeEventListener("focus", onFocus);
      unsubscribe?.();
    };
  }, [refresh]);
  useEffect(() => {
    if (!status || !identity) return;
    const defaultOrg = status.orgs.find((org) => org.id === status.defaultOrgId) ?? null;
    setPins((current) => initializeChatPin(current, identity.key, identity.aliases, defaultOrg));
  }, [status, identity]);
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
    } catch {
      setError(
        "Org context could not be saved on this device. Keep this window open or retry after restarting Headful.",
      );
    }
  }, [pins]);
  useEffect(() => {
    setNotice("");
  }, [identity?.key]);

  const pin = identity ? (pins[identity.key] ?? null) : null;
  const org = status?.orgs.find((candidate) => candidate.id === pin?.orgId) ?? null;
  const matches = !!pin && !!org && pinMatchesConnection(pin, org);
  const connected = matches && org.status === "connected" && !error;
  const experimentalEnabled = status?.features.some(
    (feature) => feature.id === "internal-chat" && feature.enabled,
  );
  const selectOrg = (id: string) => {
    if (!identity || !status) return;
    const selected = status.orgs.find((candidate) => candidate.id === id);
    const next = selected ? pinOrg(selected) : null;
    setPins((current) => {
      const updated = { ...current, [identity.key]: next };
      for (const alias of identity.aliases) updated[alias] = next;
      return updated;
    });
    setNotice(
      selected
        ? `Pinned ${selected.label} to this conversation. Copy the context to share it with your agent.`
        : "Cleared this conversation's Salesforce context.",
    );
  };
  const copy = async () => {
    if (!pin || !connected) return;
    try {
      await navigator.clipboard.writeText(chatOrgInstructions(pin));
      setNotice("Org context copied. Paste it into this conversation to share it with the agent.");
    } catch {
      setError("Could not copy org context. Check this app's clipboard permissions and retry.");
    }
  };
  return (
    <header className="hf-chat-context" aria-label="Headful conversation context">
      <div className="hf-chat-context-top">
        <button
          className="hf-chat-brand"
          type="button"
          onClick={() => leaveChat("orgs")}
          title="Return to Headful"
        >
          <img src={helmet} alt="" />
          <strong>Headful</strong>
        </button>
        <span className="hf-chat-badge">Experimental chat</span>
        <label className="hf-chat-org-picker">
          <span>Conversation org</span>
          <select
            value={pin?.orgId ?? ""}
            disabled={!status || !identity}
            onChange={(event) => selectOrg(event.target.value)}
          >
            <option value="">
              {identity ? "No org context" : "Open a conversation to pin an org"}
            </option>
            {pin && !org && <option value={pin.orgId}>{pin.label} — disconnected</option>}
            {status?.orgs.map((candidate) => (
              <option value={candidate.id} key={candidate.id}>
                {candidate.label} ·{" "}
                {candidate.isSandbox
                  ? "Sandbox"
                  : candidate.isSandbox === false
                    ? "Production"
                    : "Unverified"}
                {candidate.id === status.defaultOrgId ? " · Default" : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={!connected} onClick={() => void copy()}>
          Copy org context
        </button>
        <button
          type="button"
          disabled={!connected}
          onClick={() => {
            if (pin) leaveChat(`workspace?orgId=${encodeURIComponent(pin.orgId)}`);
          }}
        >
          Open workspace
        </button>
        <button type="button" onClick={() => leaveChat("integrations")}>
          Agent access
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void refresh()}
          aria-label="Refresh org context"
        >
          {pending ? "…" : "↻"}
        </button>
      </div>
      <div className="hf-chat-context-note" role="status">
        {error ? (
          <span className="hf-chat-warning">{error}</span>
        ) : notice ? (
          notice
        ) : status && !experimentalEnabled ? (
          <span className="hf-chat-warning">
            Internal chat is now disabled. Return to Headful Settings to enable it.
          </span>
        ) : pin && !matches ? (
          <span className="hf-chat-warning">
            Saved org context is unavailable or its connection identity changed.{" "}
            {org && (
              <button type="button" onClick={() => selectOrg(org.id)}>
                Use current connection
              </button>
            )}{" "}
            Choose an org explicitly to continue.
          </span>
        ) : pin && !connected ? (
          <span className="hf-chat-warning">
            This org needs reconnection in Headful. Its saved conversation context has been
            retained.
          </span>
        ) : connected && !org.agentEnabled ? (
          <span className="hf-chat-warning">
            Agent access is disabled for this org. Enable it in Your orgs, then configure a scoped
            grant in Agent access.
          </span>
        ) : connected ? (
          <>
            <span className="hf-chat-dot" style={{ background: org.color }} />
            {org.alias || org.label} ·{" "}
            {org.isSandbox ? "Sandbox" : org.isSandbox === false ? "Production" : "Unverified"} ·
            Pinned to this conversation. Configure the provider's Headful MCP grant in Agent access;
            this picker shares metadata only.
          </>
        ) : (
          "Choose a provider in the existing setup. Salesforce credentials stay in the Mac runtime; review CRM changes in the Headful workspace."
        )}
      </div>
    </header>
  );
}
