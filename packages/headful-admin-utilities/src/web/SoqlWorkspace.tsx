import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { headfulUtilityResultSchemas } from "@t3tools/contracts/headful-utilities";
import type { z } from "zod";
import { displayValue, downloadLocal, recordsCsv } from "./data";
import { Empty, UtilityPanel, useUtilityTask } from "./primitives";
import { useObjects, type Describe } from "./objects";
import type { UtilityComponentProps } from "./types";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { PaneDivider } from "./PaneDivider";
import { PanelTabs, panelTabId } from "./PanelTabs";
import { DockTargets, useCompactPanels, type DockEdge } from "./PanelLayout";

type QueryData = z.infer<(typeof headfulUtilityResultSchemas)["utilities.query.run"]>;
type Saved = z.infer<(typeof headfulUtilityResultSchemas)["utilities.saved.list"]>;
type History = z.infer<(typeof headfulUtilityResultSchemas)["utilities.history.list"]>;

export function SavedQueriesControl(props: UtilityComponentProps) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const task = useUtilityTask();
  const read = () =>
    void task.run(
      async () =>
        headfulUtilityResultSchemas["utilities.saved.list"].parse(
          await props.dispatch("utilities.saved.list", { orgId: props.orgId }),
        ),
      setSaved,
    );
  useEffect(() => {
    task.reset();
    setSaved(null);
    setOpen(false);
    return task.reset;
  }, [props.orgId, task.reset]);
  return (
    <div className="hf-utility-popover">
      <button
        className="hf-button hf-compact"
        ref={trigger}
        type="button"
        disabled={!props.orgId}
        aria-expanded={open}
        onClick={() => {
          if (!open) read();
          setOpen(!open);
        }}
      >
        Saved queries ▾
      </button>
      {open && (
        <div
          className="hf-utility-popover-body"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          <strong>This org’s saved queries</strong>
          {task.error && <p role="alert">{task.error}</p>}
          {saved?.queries.map((item) => (
            <button
              className="hf-utility-link"
              type="button"
              key={item.id}
              onClick={() => {
                setOpen(false);
                props.onNavigate("headful.admin-utilities/soql-workspace", {
                  orgId: item.orgId,
                  query: item.query,
                });
              }}
            >
              {item.name}
            </button>
          ))}
          {saved?.queries.length === 0 && (
            <p className="hf-note">Save a query in the SOQL workspace.</p>
          )}
        </div>
      )}
    </div>
  );
}

const starterQueries = [
  {
    title: "Active users",
    object: "User",
    query:
      "SELECT Id, Name, Username, Profile.Name, LastLoginDate FROM User WHERE IsActive = true ORDER BY Name LIMIT 50",
  },
  {
    title: "Permission sets",
    object: "PermissionSet",
    query:
      "SELECT Id, Name, Label, Description FROM PermissionSet WHERE IsOwnedByProfile = false ORDER BY Label LIMIT 50",
  },
  {
    title: "Accounts",
    object: "Account",
    query: "SELECT Id, Name, Industry FROM Account ORDER BY Name LIMIT 50",
  },
] as const;

export function SoqlWorkspace(props: UtilityComponentProps) {
  const [query, setQuery] = useState(
    typeof props.initialInput?.query === "string"
      ? props.initialInput.query
      : "SELECT Id, Name FROM Account LIMIT 50",
  );
  const [object, setObject] = useState(
    typeof props.initialInput?.object === "string" ? props.initialInput.object : "Account",
  );
  const [fieldSearch, setFieldSearch] = useState("");
  const [describe, setDescribe] = useState<Describe | null>(null);
  const [result, setResult] = useState<QueryData | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [name, setName] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [reference, setReference] = useState<"fields" | "saved" | "history" | null>("fields");
  const viewMenu = useRef<HTMLDetailsElement>(null);
  const saveName = useRef<HTMLInputElement>(null);
  const objectListId = useId();
  const referenceId = useId();
  const referencePanel = useRef<HTMLElement>(null);
  const editor = useRef<CodeEditorHandle>(null);
  const [editorHeight, setEditorHeight] = useState(40);
  const [referenceWidth, setReferenceWidth] = useState(23);
  const [referenceHeight, setReferenceHeight] = useState(34);
  const [referenceDock, setReferenceDock] = useState<DockEdge>("right");
  const [draggingReference, setDraggingReference] = useState<string | null>(null);
  const [tabsRevision, setTabsRevision] = useState(0);
  const compact = useCompactPanels();
  const referenceBelow = compact || referenceDock === "bottom";
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !viewMenu.current?.contains(event.target))
        viewMenu.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const showReference = (next: typeof reference) => {
    setReference(next);
    viewMenu.current?.removeAttribute("open");
    requestAnimationFrame(() => {
      if (!next) viewMenu.current?.querySelector("summary")?.focus();
      else if (next === "saved") saveName.current?.focus();
      else
        referencePanel.current
          ?.querySelector<HTMLElement>(
            ".hf-query-reference-body > section:not([hidden]) input, .hf-query-reference-body > section:not([hidden]) button",
          )
          ?.focus();
    });
  };
  const active = useRef<{ orgId: string; requestId: string } | null>(null);
  const task = useUtilityTask();
  const suggestions = useUtilityTask();
  const local = useUtilityTask();
  const list = useObjects(props);
  const loadLocal = async () => {
    const [queries, entries] = await Promise.all([
      props.dispatch("utilities.saved.list", { orgId: props.orgId }),
      props.dispatch("utilities.history.list", { orgId: props.orgId }),
    ]);
    return {
      saved: headfulUtilityResultSchemas["utilities.saved.list"].parse(queries),
      history: headfulUtilityResultSchemas["utilities.history.list"].parse(entries),
    };
  };
  const refreshLocal = () =>
    void local.run(loadLocal, (data) => {
      setSaved(data.saved);
      setHistory(data.history);
    });
  useEffect(() => {
    task.reset();
    suggestions.reset();
    local.reset();
    setResult(null);
    setDescribe(null);
    setSaved(null);
    setHistory(null);
    setName("");
    setQuery(
      typeof props.initialInput?.query === "string"
        ? props.initialInput.query
        : "SELECT Id, Name FROM Account LIMIT 50",
    );
    setObject(
      typeof props.initialInput?.object === "string" ? props.initialInput.object : "Account",
    );
    if (props.orgId) refreshLocal();
    return () => {
      task.reset();
      suggestions.reset();
      local.reset();
      const running = active.current;
      if (running) {
        active.current = null;
        void props.dispatch("utilities.query.cancel", running).catch(() => undefined);
      }
    };
  }, [
    props.orgId,
    props.initialInput?.query,
    props.initialInput?.object,
    task.reset,
    suggestions.reset,
    local.reset,
  ]);
  const execute = (text = query, page = 1, size = pageSize, targetOrgId = props.orgId) => {
    if (!targetOrgId || task.busy) return;
    // @effect-diagnostics-next-line cryptoRandomUUID:off -- Browser-only read request correlation, never a credential.
    const requestId = crypto.randomUUID();
    active.current = { orgId: targetOrgId, requestId };
    setResult(null);
    void task.run(
      async () =>
        headfulUtilityResultSchemas["utilities.query.run"].parse(
          await props.dispatch("utilities.query.run", {
            orgId: targetOrgId,
            requestId,
            query: text,
            page,
            pageSize: size,
          }),
        ),
      (data) => {
        active.current = null;
        setResult(data);
        refreshLocal();
      },
    );
  };
  const cancel = async () => {
    const running = active.current;
    if (!running) return;
    setCancelBusy(true);
    try {
      const data = headfulUtilityResultSchemas["utilities.query.cancel"].parse(
        await props.dispatch("utilities.query.cancel", running),
      );
      if (data.cancelled) {
        active.current = null;
        task.reset();
        setResult(null);
        props.onFeedback("Query cancelled. No results were exported.");
        refreshLocal();
      } else
        props.onFeedback(
          "The query is no longer running. Its result or error will be shown when available.",
        );
    } catch (error) {
      props.onFeedback(
        error instanceof Error ? error.message : "The query could not be cancelled.",
      );
    } finally {
      setCancelBusy(false);
    }
  };
  const insertField = (name: string) => {
    editor.current?.insert(name);
  };
  // Only simple field selections have an unambiguous object for record navigation.
  const resultObject = result?.query.match(
    /^\s*SELECT\s+[\w.,\s]+\s+FROM\s+([A-Za-z][A-Za-z0-9_]*)\b/i,
  )?.[1];
  return (
    <UtilityPanel
      title="SOQL workspace"
      description="Read-only SELECT"
      className="hf-query-workspace"
      busy={task.busy}
      error={task.error}
    >
      <div
        className={`hf-query-layout ${reference ? "hf-query-with-reference" : ""}`}
        data-dock={referenceDock}
        style={
          {
            "--hf-reference-width": `${referenceWidth}%`,
            "--hf-reference-height": `${referenceHeight}%`,
          } as CSSProperties
        }
      >
        <div className="hf-query-main">
          <form
            className="hf-query-composer"
            style={{ flexBasis: `${editorHeight}%` }}
            onSubmit={(event) => {
              event.preventDefault();
              execute();
            }}
          >
            <div className="hf-query-commandbar">
              <button
                className="hf-button hf-primary"
                data-testid="admin-run-query"
                disabled={task.busy || !props.orgId}
              >
                Run query
              </button>
              {task.busy && (
                <button
                  className="hf-button"
                  type="button"
                  disabled={cancelBusy}
                  onClick={() => void cancel()}
                >
                  Cancel query
                </button>
              )}
              <select
                aria-label="Replace query with a starter"
                data-testid="admin-query-starter"
                value=""
                disabled={task.busy}
                onChange={(event) => {
                  const starter = starterQueries.find((item) => item.title === event.target.value);
                  if (starter) {
                    setQuery(starter.query);
                    setObject(starter.object);
                    editor.current?.focus();
                  }
                }}
              >
                <option value="">Starter query…</option>
                {starterQueries.map((item) => (
                  <option key={item.title} value={item.title}>
                    {item.title}
                  </option>
                ))}
              </select>
              <label className="hf-query-page-size">
                Rows
                <select
                  aria-label="Rows per page"
                  value={pageSize}
                  disabled={task.busy}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={250}>250</option>
                  <option value={500}>500</option>
                </select>
              </label>
              <button
                className="hf-button"
                data-testid="admin-save-query-open"
                type="button"
                onClick={() => showReference("saved")}
              >
                Save…
              </button>
              <details
                className="hf-query-view-menu"
                ref={viewMenu}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    viewMenu.current?.removeAttribute("open");
                    viewMenu.current?.querySelector("summary")?.focus();
                  }
                }}
              >
                <summary data-testid="admin-query-view">View ▾</summary>
                <div className="hf-query-view-options">
                  {(
                    [
                      ["fields", "Fields"],
                      ["saved", "Saved queries"],
                      ["history", "Query history"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      className="hf-button"
                      type="button"
                      key={id}
                      aria-pressed={reference === id}
                      data-testid={`admin-query-view-${id}`}
                      onClick={() => showReference(id)}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    className="hf-button"
                    type="button"
                    disabled={!reference}
                    data-testid="admin-query-view-hide"
                    onClick={() => showReference(null)}
                  >
                    Hide reference panel
                  </button>
                  <div className="hf-panel-menu-section">Dock reference</div>
                  {(["left", "right", "bottom"] as const).map((edge) => (
                    <button
                      className="hf-button"
                      type="button"
                      key={edge}
                      data-testid={`admin-query-dock-${edge}`}
                      aria-pressed={referenceDock === edge}
                      onClick={() => {
                        setReferenceDock(edge);
                        showReference(reference ?? "fields");
                      }}
                    >
                      {edge === "bottom"
                        ? "Below editor"
                        : edge === "left"
                          ? "Left of editor"
                          : "Right of editor"}
                    </button>
                  ))}
                  <button
                    className="hf-button"
                    type="button"
                    data-testid="admin-query-layout-reset"
                    onClick={() => {
                      setEditorHeight(40);
                      setReferenceWidth(23);
                      setReferenceHeight(34);
                      setReferenceDock("right");
                      setTabsRevision((revision) => revision + 1);
                      showReference("fields");
                    }}
                  >
                    Reset panel layout
                  </button>
                </div>
              </details>
            </div>
            <div className="hf-query-editor-label">
              <span className="hf-query-editor-caption">
                query.soql <span>⌘ Enter run · ⌘ F find · Ctrl Space complete</span>
              </span>
              <CodeEditor
                label="SOQL query"
                testId="admin-query-editor"
                language="soql"
                ref={editor}
                value={query}
                maxLength={20000}
                onChange={setQuery}
                onRun={(source) => execute(source)}
                completions={[
                  ...[
                    "SELECT",
                    "FROM",
                    "WHERE",
                    "ORDER BY",
                    "LIMIT",
                    "AND",
                    "OR",
                    "GROUP BY",
                    "HAVING",
                    "COUNT",
                    "ASC",
                    "DESC",
                    "NULL",
                  ].map((label) => ({ label, type: "keyword" })),
                  ...list.objects.map((item) => ({
                    label: item.name,
                    type: "class",
                    detail: "object",
                  })),
                  ...(describe?.fields ?? []).map((field) => ({
                    label: field.name,
                    type: "property",
                    detail: `${describe?.name} · ${field.type}`,
                  })),
                ]}
              />
            </div>
          </form>
          <PaneDivider
            label="Query editor height"
            orientation="horizontal"
            value={editorHeight}
            min={25}
            max={70}
            initial={40}
            onChange={setEditorHeight}
            testId="admin-query-divider"
          />
          {result ? (
            <section className="hf-query-results" aria-label="Query results">
              <div className="hf-card-heading">
                <div>
                  <h2>Query results</h2>
                  <p>
                    {result.returned} rows · Page {result.page} · {result.elapsedMs} ms
                    {result.hasMore ? " · More rows available" : ""}
                  </p>
                  {query !== result.query && <span className="hf-badge">Editor changed</span>}
                </div>
                <button
                  className="hf-button"
                  type="button"
                  onClick={() => {
                    downloadLocal(
                      `headful-${result.org.id}-query-page-${result.page}.csv`,
                      recordsCsv(
                        result.columns.map((column) => column.name),
                        result.records,
                      ),
                      "text/csv;charset=utf-8",
                    );
                    props.onFeedback(
                      `Exported the ${result.returned} loaded rows locally. Other pages were not fetched.`,
                    );
                  }}
                >
                  Export this page CSV ↓
                </button>
              </div>
              {result.message && <p className="hf-note">{result.message}</p>}
              {result.columns.length > 50 && (
                <p className="hf-note">
                  The table shows the first 50 columns. CSV includes all loaded columns.
                </p>
              )}
              {result.records.length > 0 ? (
                <div className="hf-utility-table-wrap">
                  <table className="hf-utility-table">
                    <thead>
                      <tr>
                        {result.columns.slice(0, 50).map((column) => (
                          <th key={column.name}>{column.label || column.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.records.map((record, index) => (
                        <tr key={index}>
                          {result.columns.slice(0, 50).map((column) => (
                            <td key={column.name}>
                              <span className="hf-utility-value">
                                {column.name === "Id" &&
                                resultObject &&
                                typeof record.Id === "string" &&
                                /^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$/.test(record.Id) ? (
                                  <button
                                    className="hf-utility-link"
                                    type="button"
                                    aria-label={`Inspect record ${record.Id}`}
                                    onClick={() =>
                                      props.onNavigate("headful.admin-utilities/record-inspector", {
                                        orgId: result.org.id,
                                        object: resultObject,
                                        recordId: String(record.Id),
                                      })
                                    }
                                  >
                                    {record.Id}
                                  </button>
                                ) : (
                                  displayValue(record[column.name])
                                )}
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>The query returned no rows.</Empty>
              )}
              <div className="hf-query-result-footer">
                <details className="hf-query-executed">
                  <summary>Executed query</summary>
                  <code>{result.query}</code>
                </details>
                <div className="hf-actions">
                  <button
                    className="hf-button"
                    type="button"
                    disabled={result.page <= 1 || task.busy}
                    onClick={() =>
                      execute(result.query, result.page - 1, result.pageSize, result.org.id)
                    }
                  >
                    ← Previous page
                  </button>
                  <span className="hf-muted">Page {result.page}</span>
                  <button
                    className="hf-button"
                    type="button"
                    disabled={!result.hasMore || task.busy || result.page >= 41}
                    onClick={() =>
                      execute(result.query, result.page + 1, result.pageSize, result.org.id)
                    }
                  >
                    Next page →
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <section className="hf-query-results" aria-label="Query results">
              <div className="hf-card-heading">
                <h2>Results</h2>
                <span className="hf-muted">Read only · SELECT</span>
              </div>
              <div className="hf-query-awaiting" role="status">
                {task.busy ? "Running query…" : "Run a query to inspect its results."}
              </div>
            </section>
          )}
        </div>
        <PaneDivider
          label={`Query reference ${referenceBelow ? "height" : "width"}`}
          value={referenceBelow ? referenceHeight : referenceWidth}
          min={20}
          max={referenceBelow ? 50 : 38}
          initial={referenceBelow ? 34 : 23}
          onChange={referenceBelow ? setReferenceHeight : setReferenceWidth}
          edge={referenceDock === "left" && !compact ? "start" : "end"}
          orientation={referenceBelow ? "horizontal" : "vertical"}
          hidden={!reference}
          testId="admin-query-reference-divider"
        />
        <aside
          className="hf-query-reference"
          id={referenceId}
          ref={referencePanel}
          hidden={!reference}
          aria-label="Query reference"
          data-testid="admin-query-reference"
        >
          <div className="hf-query-reference-heading">
            <PanelTabs
              key={tabsRevision}
              idPrefix={referenceId}
              label="Query reference panels"
              value={reference ?? "fields"}
              items={(
                [
                  ["fields", "Fields"],
                  ["saved", "Saved"],
                  ["history", "History"],
                ] as const
              ).map(([id, label]) => ({
                id,
                label,
                panelId: `${referenceId}-${id}`,
                testId: `admin-query-reference-${id}`,
              }))}
              onChange={(id) => setReference(id as "fields" | "saved" | "history")}
              onDragOut={setDraggingReference}
              onDragFinish={() => setDraggingReference(null)}
            />
            <button
              className="hf-icon-button"
              type="button"
              aria-label="Hide query reference panel"
              data-testid="admin-query-reference-close"
              onClick={() => {
                setReference(null);
                viewMenu.current?.querySelector("summary")?.focus();
              }}
            >
              ×
            </button>
          </div>
          <div className="hf-query-reference-body">
            <section
              hidden={reference !== "fields"}
              aria-label="Object and field suggestions"
              role="tabpanel"
              id={`${referenceId}-fields`}
              aria-labelledby={panelTabId(referenceId, "fields")}
            >
              <h2>Object & field suggestions</h2>
              <div className="hf-utility-toolbar">
                <label className="hf-field hf-utility-grow">
                  Object API name
                  <input
                    list={objectListId}
                    value={object}
                    onChange={(event) => setObject(event.target.value)}
                    maxLength={80}
                    placeholder="Account"
                  />
                  <datalist id={objectListId}>
                    {list.objects.map((item) => (
                      <option key={item.name} value={item.name} />
                    ))}
                  </datalist>
                </label>
                <button
                  className="hf-button"
                  type="button"
                  disabled={suggestions.busy || !props.orgId || !object}
                  onClick={() =>
                    void suggestions.run(
                      async () =>
                        headfulUtilityResultSchemas["utilities.objects.describe"].parse(
                          await props.dispatch("utilities.objects.describe", {
                            orgId: props.orgId,
                            object,
                          }),
                        ),
                      setDescribe,
                    )
                  }
                >
                  Read fields
                </button>
                <button
                  className="hf-button"
                  type="button"
                  disabled={task.busy || !object}
                  onClick={() => {
                    setQuery(`SELECT Id FROM ${object} LIMIT 50`);
                    editor.current?.focus();
                  }}
                >
                  Use starter query
                </button>
              </div>
              {(suggestions.error || list.error) && (
                <p className="hf-note" role="status">
                  Schema suggestions unavailable: {suggestions.error || list.error}. You can still
                  enter a supported query.
                </p>
              )}
              {describe && (
                <>
                  <label className="hf-field">
                    Find field
                    <input
                      value={fieldSearch}
                      onChange={(event) => setFieldSearch(event.target.value)}
                      placeholder="Label or API name"
                    />
                  </label>
                  <div className="hf-utility-field-chips">
                    {describe.fields
                      .filter((field) =>
                        `${field.name} ${field.label}`
                          .toLowerCase()
                          .includes(fieldSearch.toLowerCase()),
                      )
                      .slice(0, 100)
                      .map((field) => (
                        <button
                          className="hf-button hf-compact"
                          type="button"
                          key={field.name}
                          aria-label={`${field.label} (${field.name}), ${field.type}`}
                          onClick={() => insertField(field.name)}
                        >
                          {field.name}
                        </button>
                      ))}
                  </div>
                  <p className="hf-note">
                    Choose a field to insert its API name at the editor cursor. Filter to find more
                    fields.
                  </p>
                </>
              )}
            </section>
            {local.error && <p role="alert">{local.error}</p>}
            <section
              hidden={reference !== "saved"}
              aria-label="Saved queries"
              role="tabpanel"
              id={`${referenceId}-saved`}
              aria-labelledby={panelTabId(referenceId, "saved")}
            >
              <h2>Saved queries</h2>
              <form
                className="hf-utility-toolbar"
                onSubmit={(event) => {
                  event.preventDefault();
                  void local.run(
                    async () => {
                      await props.dispatch("utilities.saved.set", {
                        orgId: props.orgId,
                        name,
                        query,
                      });
                      return loadLocal();
                    },
                    (data) => {
                      setSaved(data.saved);
                      setHistory(data.history);
                      setName("");
                      props.onFeedback("Saved this query for the selected org.");
                    },
                  );
                }}
              >
                <label className="hf-field hf-utility-grow">
                  Query name
                  <input
                    ref={saveName}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={100}
                    required
                    placeholder="Useful accounts"
                  />
                </label>
                <button className="hf-button" disabled={local.busy || !props.orgId}>
                  Save query
                </button>
              </form>
              <div className="hf-utility-saved-list">
                {saved?.queries.map((item) => (
                  <div key={item.id}>
                    <button
                      className="hf-utility-link"
                      type="button"
                      onClick={() => {
                        props.onNavigate("headful.admin-utilities/soql-workspace", {
                          orgId: item.orgId,
                          query: item.query,
                        });
                      }}
                    >
                      {item.name}
                    </button>
                    <button
                      className="hf-icon-button"
                      type="button"
                      aria-label={`Remove saved query ${item.name}`}
                      disabled={local.busy}
                      onClick={() =>
                        void local.run(
                          async () => {
                            await props.dispatch("utilities.saved.remove", {
                              orgId: item.orgId,
                              id: item.id,
                            });
                            return loadLocal();
                          },
                          (data) => {
                            setSaved(data.saved);
                            setHistory(data.history);
                          },
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {saved?.queries.length === 0 && (
                <p className="hf-note">
                  Saved queries keep this org context. They contain query text, not a cached export
                  of records.
                </p>
              )}
            </section>
            <section
              hidden={reference !== "history"}
              aria-label="Query history"
              role="tabpanel"
              id={`${referenceId}-history`}
              aria-labelledby={panelTabId(referenceId, "history")}
            >
              <div className="hf-card-heading">
                <h2>Query history</h2>
                <button
                  className="hf-button hf-compact"
                  type="button"
                  disabled={local.busy}
                  onClick={refreshLocal}
                >
                  Refresh
                </button>
              </div>
              <div className="hf-utility-history">
                {history?.history.map((item) => (
                  <button
                    className="hf-utility-history-item"
                    type="button"
                    key={item.id}
                    onClick={() => {
                      props.onNavigate("headful.admin-utilities/soql-workspace", {
                        orgId: item.orgId,
                        query: item.query,
                      });
                    }}
                  >
                    <code>{item.query}</code>
                    <small>
                      {new Date(item.createdAt).toLocaleString()} · {item.status} · {item.returned}{" "}
                      rows · {item.elapsedMs} ms
                    </small>
                  </button>
                ))}
              </div>
              {history?.history.length === 0 && (
                <p className="hf-note">No queries run for this org yet.</p>
              )}
            </section>
          </div>
          <p className="hf-query-local-note">
            Saved queries and history stay on this Mac. CSV exports include only loaded rows.
          </p>
        </aside>
        <DockTargets
          active={draggingReference !== null}
          label="Reference"
          testId="admin-query-drop"
          onDock={(edge) => {
            if (
              draggingReference !== "fields" &&
              draggingReference !== "saved" &&
              draggingReference !== "history"
            )
              return;
            setReferenceDock(edge);
            showReference(draggingReference);
            setDraggingReference(null);
          }}
        />
      </div>
    </UtilityPanel>
  );
}
