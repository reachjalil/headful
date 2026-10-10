import { useEffect, useState } from "react";
import { headfulUtilityResultSchemas } from "@t3tools/contracts/headful-utilities";
import type { z } from "zod";
import { copyLocal } from "./data";
import { Empty, UtilityPanel, useUtilityTask } from "./primitives";
import type { UtilityComponentProps } from "./types";

type DiagnosticsData = z.infer<(typeof headfulUtilityResultSchemas)["utilities.diagnostics"]>;
type Logs = z.infer<(typeof headfulUtilityResultSchemas)["utilities.logs.list"]>;
type Log = z.infer<(typeof headfulUtilityResultSchemas)["utilities.logs.get"]>;

export function Diagnostics(props: UtilityComponentProps) {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [logs, setLogs] = useState<Logs | null>(null);
  const [log, setLog] = useState<Log | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"overview" | "jobs" | "logs">("overview");
  const task = useUtilityTask();
  const logTask = useUtilityTask();
  const read = () =>
    void task.run(
      async () =>
        headfulUtilityResultSchemas["utilities.diagnostics"].parse(
          await props.dispatch("utilities.diagnostics", { orgId: props.orgId }),
        ),
      setData,
    );
  useEffect(() => {
    task.reset();
    logTask.reset();
    setData(null);
    setLogs(null);
    setLog(null);
    setView("overview");
    if (props.orgId) read();
    return () => {
      task.reset();
      logTask.reset();
    };
  }, [props.orgId, task.reset, logTask.reset]);
  const limits =
    data?.limits.filter((limit) => limit.name.toLowerCase().includes(search.toLowerCase())) ?? [];
  return (
    <UtilityPanel
      className="hf-health-workspace"
      title="Org diagnostics"
      description="Inspect storage, limits, recent Apex jobs and available debug logs."
      busy={task.busy}
      error={task.error}
      actions={
        <button
          className="hf-button"
          type="button"
          disabled={task.busy || !props.orgId}
          onClick={read}
        >
          Refresh diagnostics
        </button>
      }
    >
      <div className="hf-panel-switcher" role="group" aria-label="Diagnostics view">
        {(
          [
            ["overview", "Storage & limits"],
            ["jobs", "Jobs"],
            ["logs", "Debug logs"],
          ] as const
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            data-testid={`admin-health-${id}`}
            aria-pressed={view === id}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="hf-health-panels">
        {data && (
          <>
            {data.messages.map((message, index) => (
              <p className="hf-notice" role="status" key={index}>
                {message}
              </p>
            ))}
            <section className="hf-card" hidden={view !== "overview"}>
              <h2>Storage</h2>
              <div className="hf-utility-storage">
                {data.storage.map((storage) => (
                  <article key={storage.name}>
                    <strong>{storage.name}</strong>
                    <span>
                      {Math.max(0, storage.max - storage.remaining).toLocaleString()} /{" "}
                      {storage.max.toLocaleString()} MB used
                    </span>
                    <progress
                      aria-label={`${storage.name} used`}
                      max={storage.max || 1}
                      value={Math.max(0, storage.max - storage.remaining)}
                    />
                    <small>{storage.remaining.toLocaleString()} MB remaining</small>
                  </article>
                ))}
              </div>
              {data.storage.length === 0 && (
                <p className="hf-note">Storage information is unavailable for this connection.</p>
              )}
            </section>
            <section className="hf-card" hidden={view !== "overview"}>
              <div className="hf-card-heading">
                <h2>Limits</h2>
                <span className="hf-badge">{data.limits.length} reported</span>
              </div>
              <label className="hf-field hf-utility-search">
                Find limit
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="API, storage, or other limit"
                />
              </label>
              <div className="hf-utility-table-wrap">
                <table className="hf-utility-table">
                  <thead>
                    <tr>
                      <th>Limit</th>
                      <th>Used</th>
                      <th>Remaining</th>
                      <th>Maximum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {limits.map((limit) => (
                      <tr key={limit.name}>
                        <td>{limit.name}</td>
                        <td>{Math.max(0, limit.max - limit.remaining).toLocaleString()}</td>
                        <td>{limit.remaining.toLocaleString()}</td>
                        <td>{limit.max.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {limits.length === 0 && <Empty>No reported limits match this filter.</Empty>}
            </section>
            <section className="hf-card" hidden={view !== "jobs"}>
              <h2>Recent jobs</h2>
              {data.jobs.length > 0 ? (
                <div className="hf-utility-table-wrap">
                  <table className="hf-utility-table">
                    <thead>
                      <tr>
                        <th>Job</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Progress</th>
                        <th>Errors</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.jobs.map((job) => (
                        <tr key={job.id}>
                          <td>
                            <code>{job.id}</code>
                          </td>
                          <td>{job.type}</td>
                          <td>{job.status}</td>
                          <td>
                            {job.processed} / {job.total}
                          </td>
                          <td>{job.errors}</td>
                          <td>{job.createdAt || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>
                  No recent jobs were returned. Availability depends on org permissions.
                </Empty>
              )}
            </section>
          </>
        )}
        <section className="hf-card" hidden={view !== "logs"}>
          <div className="hf-card-heading">
            <div>
              <h2>Debug logs</h2>
              <p>Read-only diagnostic content, kept in the local workspace.</p>
            </div>
            <button
              className="hf-button"
              type="button"
              disabled={logTask.busy || !props.orgId}
              onClick={() =>
                void logTask.run(
                  async () =>
                    headfulUtilityResultSchemas["utilities.logs.list"].parse(
                      await props.dispatch("utilities.logs.list", { orgId: props.orgId }),
                    ),
                  setLogs,
                )
              }
            >
              List available logs
            </button>
          </div>
          {logTask.busy && (
            <p className="hf-progress" role="status">
              Reading debug logs…
            </p>
          )}
          {logTask.error && (
            <p className="hf-alert" role="alert">
              {logTask.error}
            </p>
          )}
          {logs && (
            <div className="hf-utility-table-wrap">
              <table className="hf-utility-table">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Operation</th>
                    <th>Status</th>
                    <th>Size / duration</th>
                    <th>Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.logs.map((item) => (
                    <tr key={item.id}>
                      <td>{item.startTime || "—"}</td>
                      <td>{item.operation || "—"}</td>
                      <td>{item.status || "—"}</td>
                      <td>
                        {item.length.toLocaleString()} bytes
                        <small>{item.durationMs === null ? "—" : `${item.durationMs} ms`}</small>
                      </td>
                      <td>
                        <button
                          className="hf-button hf-compact"
                          type="button"
                          disabled={logTask.busy}
                          onClick={() =>
                            void logTask.run(
                              async () =>
                                headfulUtilityResultSchemas["utilities.logs.get"].parse(
                                  await props.dispatch("utilities.logs.get", {
                                    orgId: props.orgId,
                                    logId: item.id,
                                  }),
                                ),
                              setLog,
                            )
                          }
                        >
                          Read log
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {logs?.logs.length === 0 && (
            <Empty>
              No accessible debug logs. Headful does not create trace flags in this read-only slice.
            </Empty>
          )}
          {log && (
            <div className="hf-utility-log">
              <div className="hf-card-heading">
                <div>
                  <strong>Debug log</strong>
                  <code>{log.logId}</code>
                </div>
                <div className="hf-actions">
                  <button
                    className="hf-button"
                    type="button"
                    onClick={() => void copyLocal(log.body, props.onFeedback)}
                  >
                    Copy log
                  </button>
                  <button className="hf-button" type="button" onClick={() => setLog(null)}>
                    Close log
                  </button>
                </div>
              </div>
              <pre tabIndex={0}>{log.body}</pre>
              <p className="hf-note">
                Logs can contain CRM details. Review their contents before sharing.
              </p>
            </div>
          )}
        </section>
      </div>
    </UtilityPanel>
  );
}
