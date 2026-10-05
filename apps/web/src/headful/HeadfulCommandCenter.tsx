/* oxlint-disable shadcn/no-unknown-classes -- This isolated Headful surface uses the imported CSS module, not Tailwind utilities. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, CheckCheck, RefreshCw, Search, Trash2, X } from "lucide-react";
import { z } from "zod";
import { headfulResultSchemas, type HeadfulResult } from "@t3tools/contracts/headful";
import {
  filterSearchEntries,
  type CommandDestination,
  type NotificationEntry,
  type SearchEntry,
} from "./command-center";
import "./command-center.css";

type InboxData = {
  workflows: HeadfulResult<"listWorkflows">["workflows"];
  activity: HeadfulResult<"activity.list">["activity"];
};

/** Bounded local reads; refresh only while this client is visible. */
export function useHeadfulInbox({
  ready,
  reviewedEnabled,
  dispatch,
  refreshShell,
}: {
  ready: boolean;
  reviewedEnabled: boolean;
  dispatch: (operation: string, input?: unknown) => Promise<unknown>;
  refreshShell: () => Promise<void>;
}) {
  const [data, setData] = useState<InboxData>({ workflows: [], activity: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const inFlight = useRef<number | null>(null);
  const refresh = useCallback(async () => {
    if (!ready || document.visibilityState === "hidden") return;
    const generation = epoch.current;
    if (inFlight.current === generation) return;
    inFlight.current = generation;
    setLoading(true);
    setError("");
    try {
      await refreshShell();
      const next: InboxData = reviewedEnabled
        ? await Promise.all([dispatch("listWorkflows"), dispatch("activity.list")]).then(
            ([workflows, activity]) => ({
              workflows: headfulResultSchemas.listWorkflows.parse(workflows).workflows,
              activity: headfulResultSchemas["activity.list"].parse(activity).activity,
            }),
          )
        : { workflows: [], activity: [] };
      if (epoch.current === generation) setData(next);
    } catch {
      if (epoch.current === generation)
        setError("Updates could not refresh. Showing the last loaded local activity.");
    } finally {
      if (inFlight.current === generation) inFlight.current = null;
      if (epoch.current === generation) setLoading(false);
    }
  }, [ready, reviewedEnabled, dispatch, refreshShell]);
  useEffect(() => {
    epoch.current += 1;
    if (!ready) return;
    void refresh();
    const update = () => void refresh();
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      epoch.current += 1;
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [ready, refresh]);
  return {
    ...(reviewedEnabled ? data : { workflows: [], activity: [] }),
    loading,
    error,
    refresh,
  };
}

const inboxStateSchema = z.object({
  read: z.array(z.string().max(300)).max(500),
  dismissed: z.array(z.string().max(300)).max(500),
});
const inboxStorageKey = "headful.notifications.v1";
function loadInboxState(): z.infer<typeof inboxStateSchema> {
  try {
    return inboxStateSchema.parse(JSON.parse(localStorage.getItem(inboxStorageKey) || "null"));
  } catch {
    return { read: [], dismissed: [] };
  }
}
const keepIds = (previous: string[], next: string[]) =>
  [...new Set([...previous, ...next])].slice(-500);

export function HeadfulCommandCenter({
  entries,
  notifications,
  loading,
  error,
  onRefresh,
  onNavigate,
}: {
  entries: SearchEntry[];
  notifications: NotificationEntry[];
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onNavigate: (destination: CommandDestination) => void;
}) {
  const [panel, setPanel] = useState<"search" | "notifications" | null>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [inboxState, setInboxState] = useState(loadInboxState);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const results = useMemo(() => filterSearchEntries(entries, query), [entries, query]);
  const selected = Math.min(index, Math.max(0, results.length - 1));
  const visibleNotifications = notifications.filter(
    (item) => !inboxState.dismissed.includes(item.id),
  );
  const unread = visibleNotifications.filter((item) => !inboxState.read.includes(item.id)).length;
  useEffect(() => {
    try {
      // Store identifiers only, never Salesforce record contents or credentials.
      localStorage.setItem(inboxStorageKey, JSON.stringify(inboxState));
    } catch {
      // An unavailable storage area should not block navigation or local work.
    }
  }, [inboxState]);
  const open = useCallback((next: "search" | "notifications") => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setIndex(0);
    setPanel(next);
  }, []);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        !event.defaultPrevented &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k" &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        open("search");
        onRefresh();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [open, onRefresh]);
  useEffect(() => {
    if (panel === "search")
      document
        .getElementById(`hf-search-result-${selected}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [selected, panel]);
  useEffect(() => {
    const element = dialog.current;
    if (panel && element && !element.open) {
      element.showModal();
      if (panel === "search") input.current?.focus();
    } else if (!panel && element?.open) {
      element.close();
      // A navigation may unmount the original workspace control.
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
      else searchTrigger.current?.focus();
    }
  }, [panel]);
  const visit = (destination: CommandDestination) => {
    setPanel(null);
    onNavigate(destination);
  };
  const markRead = (ids: string[]) =>
    setInboxState((value) => ({ ...value, read: keepIds(value.read, ids) }));

  return (
    <>
      <div className="hf-sidebar-toolbar" role="toolbar" aria-label="Search and notifications">
        <button
          className="hf-search-trigger"
          type="button"
          ref={searchTrigger}
          aria-label="Search Headful"
          aria-keyshortcuts="Meta+K Control+K"
          onClick={() => {
            open("search");
            onRefresh();
          }}
        >
          <Search size={14} aria-hidden="true" />
          <span>Search</span>
        </button>
        <button
          className="hf-inbox-trigger"
          type="button"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          onClick={() => {
            open("notifications");
            onRefresh();
          }}
        >
          <Bell size={15} aria-hidden="true" />
          {unread > 0 && <span className="hf-inbox-dot" aria-hidden="true" />}
        </button>
      </div>
      <dialog
        ref={dialog}
        className="hf-command-center"
        aria-labelledby="hf-command-center-title"
        onCancel={(event) => {
          event.preventDefault();
          setPanel(null);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setPanel(null);
        }}
      >
        <div className="hf-command-center-heading">
          <h2 id="hf-command-center-title">
            {panel === "search" ? "Search Headful" : "Notifications"}
          </h2>
          <button
            className="hf-icon-button"
            type="button"
            aria-label="Close search and notifications"
            onClick={() => setPanel(null)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {panel === "search" ? (
          <>
            <div className="hf-global-search-field">
              <Search size={17} aria-hidden="true" />
              <input
                ref={input}
                aria-label="Search pages, orgs, utilities and saved work"
                role="combobox"
                aria-expanded="true"
                aria-controls="hf-global-search-results"
                aria-autocomplete="list"
                aria-activedescendant={results.length ? `hf-search-result-${selected}` : undefined}
                placeholder="Pages, orgs, utilities, saved work…"
                value={query}
                maxLength={200}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setIndex(
                      results.length
                        ? (selected + (event.key === "ArrowDown" ? 1 : -1) + results.length) %
                            results.length
                        : 0,
                    );
                  } else if (event.key === "Enter" && results[selected]) {
                    event.preventDefault();
                    visit(results[selected].destination);
                  }
                }}
              />
            </div>
            <div
              className="hf-command-center-scroll"
              id="hf-global-search-results"
              role="listbox"
              aria-label="Search results"
            >
              {results.map((item, position) => (
                <div
                  key={item.id}
                  id={`hf-search-result-${position}`}
                  role="option"
                  aria-selected={selected === position}
                  className={
                    selected === position
                      ? "hf-global-search-option selected"
                      : "hf-global-search-option"
                  }
                >
                  <button type="button" tabIndex={-1} onClick={() => visit(item.destination)}>
                    <span className="hf-search-result-copy">
                      <strong>{item.title}</strong>
                      <small>{item.description}</small>
                    </span>
                    <span className="hf-search-result-group">{item.group}</span>
                  </button>
                </div>
              ))}
              {!results.length && (
                <p className="hf-command-center-empty">
                  No results for “{query}”. Try an org name, SOQL, settings or a saved task.
                </p>
              )}
            </div>
            <div className="hf-command-center-footer">
              <span>↑ ↓ navigate · ↵ open · Esc close</span>
              <span>Searches your local workspace</span>
            </div>
          </>
        ) : (
          <>
            <div className="hf-inbox-actions">
              <span>{unread ? `${unread} unread` : "All read"}</span>
              <div>
                <button
                  className="hf-icon-button"
                  type="button"
                  aria-label="Refresh notifications"
                  disabled={loading}
                  onClick={onRefresh}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                </button>
                <button
                  className="hf-button hf-compact"
                  type="button"
                  disabled={!unread}
                  onClick={() => markRead(visibleNotifications.map((item) => item.id))}
                >
                  <CheckCheck size={14} aria-hidden="true" />
                  Mark all read
                </button>
                <button
                  className="hf-icon-button"
                  type="button"
                  aria-label="Dismiss read notifications"
                  disabled={!visibleNotifications.some((item) => inboxState.read.includes(item.id))}
                  onClick={() =>
                    setInboxState((value) => ({
                      ...value,
                      dismissed: keepIds(
                        value.dismissed,
                        visibleNotifications
                          .filter((item) => value.read.includes(item.id))
                          .map((item) => item.id),
                      ),
                    }))
                  }
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
            {error && (
              <p className="hf-inbox-error" role="alert">
                {error}
              </p>
            )}
            {loading && (
              <p className="hf-inbox-loading" role="status">
                Checking local updates…
              </p>
            )}
            <div className="hf-command-center-scroll" aria-label="Local notifications">
              {visibleNotifications.map((item) => (
                <article
                  className={`hf-inbox-item ${inboxState.read.includes(item.id) ? "read" : "unread"}`}
                  key={item.id}
                >
                  <button
                    className="hf-inbox-item-open"
                    type="button"
                    onClick={() => {
                      markRead([item.id]);
                      visit(item.destination);
                    }}
                  >
                    <span className={`hf-inbox-indicator ${item.level}`} aria-label={item.level} />
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.description}</small>
                      {item.timestamp !== undefined && (
                        <time dateTime={new Date(item.timestamp).toISOString()}>
                          {new Date(item.timestamp).toLocaleString()}
                        </time>
                      )}
                    </span>
                  </button>
                  <button
                    className="hf-icon-button"
                    type="button"
                    aria-label={`Dismiss ${item.title}`}
                    onClick={() =>
                      setInboxState((value) => ({
                        read: keepIds(value.read, [item.id]),
                        dismissed: keepIds(value.dismissed, [item.id]),
                      }))
                    }
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </article>
              ))}
              {!visibleNotifications.length && !loading && (
                <div className="hf-command-center-empty">
                  <Bell size={22} aria-hidden="true" />
                  <strong>You’re all caught up</strong>
                  <p>Setup issues and reviewed-work updates will appear here.</p>
                </div>
              )}
            </div>
            <div className="hf-command-center-footer">
              <span>Local activity · updates every 30s while visible</span>
              <span>Esc close</span>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
