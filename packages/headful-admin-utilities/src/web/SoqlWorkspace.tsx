import { useEffect, useRef, useState } from "react";
import { headfulUtilityResultSchemas } from "@t3tools/contracts/headful-utilities";
import type { z } from "zod";
import { displayValue, downloadLocal, recordsCsv } from "./data";
import { Empty, UtilityPanel, useUtilityTask } from "./primitives";
import { useObjects, type Describe } from "./SchemaExplorer";
import type { UtilityComponentProps } from "./types";

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
                props.onNavigate("admin-utilities/soql-workspace", {
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

export function SoqlWorkspace(props: UtilityComponentProps) {
  const [query, setQuery] = useState("SELECT Id, Name FROM Account LIMIT 50");
  const [object, setObject] = useState("Account");
  const [fieldSearch, setFieldSearch] = useState("");
  const [describe, setDescribe] = useState<Describe | null>(null);
  const [result, setResult] = useState<QueryData | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [name, setName] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [cancelBusy, setCancelBusy] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
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
    const start = editor.current?.selectionStart ?? query.length;
    const end = editor.current?.selectionEnd ?? start;
    setQuery(query.slice(0, start) + name + query.slice(end));
    editor.current?.focus();
  };
  return (
    <UtilityPanel
      title="SOQL workspace"
      description="Query the selected org without changing records. Saved queries and query history stay on this Mac, grouped by org."
      busy={task.busy}
      error={task.error}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          execute();
        }}
      >
        <label className="hf-field">
          SOQL
          <textarea
            className="hf-query-editor"
            ref={editor}
            value={query}
            maxLength={20000}
            required
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                execute();
              }
            }}
          />
        </label>
        <div className="hf-utility-toolbar">
          <button className="hf-button hf-primary" disabled={task.busy || !props.orgId}>
            Run query <kbd>⌘↵</kbd>
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
          <label className="hf-field">
            Rows per page
            <select
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
          <span className="hf-note">Read-only SELECT queries · Up to 500 rows per page</span>
        </div>
      </form>
      <details className="hf-advanced">
        <summary>Object and field suggestions</summary>
        <div className="hf-utility-toolbar">
          <label className="hf-field hf-utility-grow">
            Object API name
            <input
              list="hf-query-objects"
              value={object}
              onChange={(event) => setObject(event.target.value)}
              maxLength={80}
              placeholder="Account"
            />
            <datalist id="hf-query-objects">
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
            Schema suggestions unavailable: {suggestions.error || list.error}. You can still enter a
            supported query.
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
                  `${field.name} ${field.label}`.toLowerCase().includes(fieldSearch.toLowerCase()),
                )
                .slice(0, 100)
                .map((field) => (
                  <button
                    className="hf-button hf-compact"
                    type="button"
                    key={field.name}
                    title={`${field.label} · ${field.type}`}
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
      </details>
      {result && (
        <section className="hf-card">
          <div className="hf-card-heading">
            <div>
              <h2>Query results</h2>
              <p>
                {result.returned} rows · Page {result.page} · {result.elapsedMs} ms
                {result.hasMore ? " · More rows available" : ""}
              </p>
              <code>{result.query}</code>
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
                      <th key={column.name} title={column.type}>
                        {column.label || column.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.records.map((record, index) => (
                    <tr key={index}>
                      {result.columns.slice(0, 50).map((column) => (
                        <td key={column.name}>
                          <span className="hf-utility-value">
                            {displayValue(record[column.name])}
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
          <div className="hf-actions">
            <button
              className="hf-button"
              type="button"
              disabled={result.page <= 1 || task.busy}
              onClick={() => execute(result.query, result.page - 1, result.pageSize, result.org.id)}
            >
              ← Previous page
            </button>
            <span className="hf-muted">Page {result.page}</span>
            <button
              className="hf-button"
              type="button"
              disabled={!result.hasMore || task.busy || result.page >= 41}
              onClick={() => execute(result.query, result.page + 1, result.pageSize, result.org.id)}
            >
              Next page →
            </button>
          </div>
        </section>
      )}
      <div className="hf-utility-columns">
        <section className="hf-card">
          <h2>Saved queries</h2>
          {local.error && <p role="alert">{local.error}</p>}
          <form
            className="hf-utility-toolbar"
            onSubmit={(event) => {
              event.preventDefault();
              void local.run(
                async () => {
                  await props.dispatch("utilities.saved.set", { orgId: props.orgId, name, query });
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
                    props.onNavigate("admin-utilities/soql-workspace", {
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
              Saved queries keep this org context. They contain query text, not a cached export of
              records.
            </p>
          )}
        </section>
        <section className="hf-card">
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
                  props.onNavigate("admin-utilities/soql-workspace", {
                    orgId: item.orgId,
                    query: item.query,
                  });
                }}
              >
                <code>{item.query}</code>
                <small>
                  {new Date(item.createdAt).toLocaleString()} · {item.status} · {item.returned} rows
                  · {item.elapsedMs} ms
                </small>
              </button>
            ))}
          </div>
          {history?.history.length === 0 && (
            <p className="hf-note">No queries run for this org yet.</p>
          )}
        </section>
      </div>
      <p className="hf-note">
        Results are local CRM data. Exported files and clipboard copies can be shared by you;
        Headful does not send them to its website.
      </p>
    </UtilityPanel>
  );
}
