import { useEffect, useState } from "react";
import { headfulUtilityResultSchemas } from "@t3tools/contracts/headful-utilities";
import { copyLocal, displayValue } from "./data";
import { Empty, UtilityPanel, useUtilityTask } from "./primitives";
import type { UtilityComponentProps } from "./types";
import type { z } from "zod";

type RecordData = z.infer<(typeof headfulUtilityResultSchemas)["utilities.record.get"]>;

export function RecordInspector(props: UtilityComponentProps) {
  const [object, setObject] = useState("Account");
  const [recordId, setRecordId] = useState("");
  const [data, setData] = useState<RecordData | null>(null);
  const [search, setSearch] = useState("");
  const task = useUtilityTask();
  useEffect(() => {
    task.reset();
    setData(null);
    setSearch("");
    setObject(
      typeof props.initialInput?.object === "string" ? props.initialInput.object : "Account",
    );
    setRecordId(
      typeof props.initialInput?.recordId === "string" ? props.initialInput.recordId : "",
    );
    return task.reset;
  }, [props.orgId, props.initialInput?.object, props.initialInput?.recordId, task.reset]);
  const inspect = () =>
    void task.run(
      async () =>
        headfulUtilityResultSchemas["utilities.record.get"].parse(
          await props.dispatch("utilities.record.get", { orgId: props.orgId, object, recordId }),
        ),
      setData,
    );
  const fields =
    data?.fields.filter((field) =>
      `${field.name} ${field.label} ${field.type} ${displayValue(field.value)}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  return (
    <UtilityPanel
      title="Record inspector"
      description="Inspect a record’s readable fields, including fields outside its page layout. Enter its object API name and Salesforce ID. This tool is read-only."
      busy={task.busy}
      error={task.error}
    >
      <form
        className="hf-utility-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          inspect();
        }}
      >
        <label className="hf-field">
          Object API name
          <input
            value={object}
            onChange={(event) => setObject(event.target.value)}
            pattern="[A-Za-z][A-Za-z0-9_]*"
            maxLength={200}
            required
            placeholder="Account"
          />
        </label>
        <label className="hf-field hf-utility-grow">
          Record ID
          <input
            value={recordId}
            onChange={(event) => setRecordId(event.target.value)}
            pattern="[A-Za-z0-9]{15}([A-Za-z0-9]{3})?"
            maxLength={18}
            required
            placeholder="15 or 18 character Salesforce ID"
          />
        </label>
        <button className="hf-button hf-primary" disabled={task.busy || !props.orgId}>
          Inspect record
        </button>
      </form>
      {data ? (
        <>
          <div className="hf-utility-result-heading">
            <div>
              <strong>{data.object}</strong>
              <code>{data.recordId}</code>
              <span className="hf-badge">{data.fields.length} readable fields</span>
            </div>
            <div className="hf-actions">
              <button
                className="hf-button"
                type="button"
                onClick={() => void copyLocal(data.recordId, props.onFeedback)}
              >
                Copy ID
              </button>
              <button
                className="hf-button"
                type="button"
                onClick={() =>
                  void copyLocal(
                    JSON.stringify(
                      { object: data.object, recordId: data.recordId, fields: data.fields },
                      null,
                      2,
                    ),
                    props.onFeedback,
                  )
                }
              >
                Copy JSON
              </button>
              <button
                className="hf-button"
                type="button"
                onClick={() =>
                  void task.run(
                    () =>
                      props.dispatch("utilities.org.open", {
                        orgId: data.org.id,
                        destination: "record",
                        recordId: data.recordId,
                      }),
                    () => props.onFeedback("Opened the record in its original org."),
                  )
                }
              >
                Open in Salesforce ↗
              </button>
            </div>
          </div>
          <label className="hf-field hf-utility-search">
            Filter fields
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Label, API name, type, or value"
            />
          </label>
          <div className="hf-utility-table-wrap">
            <table className="hf-utility-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>API name / type</th>
                  <th>Readable value</th>
                  <th>
                    <span className="hf-visually-hidden">Copy</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field) => (
                  <tr key={field.name}>
                    <td>{field.label}</td>
                    <td>
                      <code>{field.name}</code>
                      <small>{field.type}</small>
                    </td>
                    <td>
                      <span className="hf-utility-value">{displayValue(field.value)}</span>
                    </td>
                    <td>
                      <button
                        className="hf-icon-button"
                        type="button"
                        aria-label={`Copy ${field.label}`}
                        onClick={() =>
                          void copyLocal(
                            field.value === null ? "" : displayValue(field.value),
                            props.onFeedback,
                          )
                        }
                      >
                        ⧉
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {fields.length === 0 && <Empty>No readable fields match this filter.</Empty>}
          <p className="hf-note">
            Salesforce field and object permissions apply. This inspector does not edit records.
          </p>
        </>
      ) : (
        <Empty>
          Choose an object and enter a record ID to read its accessible fields. Use the core Leads
          view when you need to find a lead first.
        </Empty>
      )}
    </UtilityPanel>
  );
}
