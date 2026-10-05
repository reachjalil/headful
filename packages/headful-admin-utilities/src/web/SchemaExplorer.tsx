import { useEffect, useState } from "react";
import { headfulUtilityResultSchemas } from "@t3tools/contracts/headful-utilities";
import type { z } from "zod";
import { downloadLocal } from "./data";
import { Empty, UtilityPanel, useUtilityTask } from "./primitives";
import type { UtilityComponentProps } from "./types";

type Objects = z.infer<(typeof headfulUtilityResultSchemas)["utilities.objects.list"]>;
export type Describe = z.infer<(typeof headfulUtilityResultSchemas)["utilities.objects.describe"]>;

export function useObjects(props: UtilityComponentProps) {
  const [objects, setObjects] = useState<Objects | null>(null);
  const task = useUtilityTask();
  useEffect(() => {
    task.reset();
    setObjects(null);
    if (props.orgId)
      void task.run(
        async () =>
          headfulUtilityResultSchemas["utilities.objects.list"].parse(
            await props.dispatch("utilities.objects.list", { orgId: props.orgId, category: "all" }),
          ),
        setObjects,
      );
    return task.reset;
  }, [props.orgId, props.dispatch, task.run, task.reset]);
  return { objects: objects?.objects ?? [], busy: task.busy, error: task.error };
}

export function SchemaExplorer(props: UtilityComponentProps) {
  const list = useObjects(props);
  const [search, setSearch] = useState("");
  const [fieldsSearch, setFieldsSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [data, setData] = useState<Describe | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const task = useUtilityTask();
  useEffect(() => {
    task.reset();
    setData(null);
    setSearch("");
    setFieldsSearch("");
    setSelected([]);
    return task.reset;
  }, [props.orgId, task.reset]);
  const objects = list.objects.filter(
    (item) =>
      item.name.toLowerCase().includes(search.toLowerCase()) &&
      (category === "all" || item.custom === (category === "custom")),
  );
  const fields =
    data?.fields.filter((field) =>
      `${field.name} ${field.label} ${field.type}`
        .toLowerCase()
        .includes(fieldsSearch.toLowerCase()),
    ) ?? [];
  const open = (object: string) =>
    void task.run(
      async () =>
        headfulUtilityResultSchemas["utilities.objects.describe"].parse(
          await props.dispatch("utilities.objects.describe", { orgId: props.orgId, object }),
        ),
      (result) => {
        setData(result);
        setSelected(result.fields.some((field) => field.name === "Id") ? ["Id"] : []);
        setFieldsSearch("");
      },
    );
  useEffect(() => {
    if (props.orgId && typeof props.initialInput?.object === "string")
      open(props.initialInput.object);
  }, [props.orgId, props.initialInput?.object]);
  const exportDocumentation = () => {
    if (!data) return;
    const text = (value: string) => value.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
    const doc = `# ${text(data.label)} (${data.name})\n\nOrg: ${data.org.label} (${data.org.salesforceOrgId})\n\nRead-only schema exported from Headful. Salesforce permissions apply.\n\n| Label | API name | Type | Relationships |\n| --- | --- | --- | --- |\n${data.fields.map((field) => `| ${text(field.label)} | ${field.name} | ${text(field.type)} | ${text(field.referenceTo.join(", "))}${field.relationshipName ? ` (${text(field.relationshipName)})` : ""} |`).join("\n")}\n`;
    downloadLocal(`${data.name}-fields.md`, doc, "text/markdown;charset=utf-8");
    props.onFeedback("Exported field documentation locally.");
  };
  return (
    <UtilityPanel
      title="Objects & fields"
      description="Find an object, inspect its fields and relationships, then open a query using the fields you select. This explorer does not change schema."
      busy={task.busy || list.busy}
      error={task.error || list.error}
    >
      <div className="hf-utility-split">
        <aside className="hf-utility-object-list">
          <label className="hf-field">
            Find object
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Account, Custom__c…"
            />
          </label>
          <label className="hf-field">
            Objects
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">All available</option>
              <option value="standard">Standard</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <small className="hf-muted">{objects.length} available · API names from CLI</small>
          <div className="hf-utility-object-options" aria-label="Available objects">
            {objects.slice(0, 300).map((item) => (
              <button
                className={`hf-utility-object-button ${data?.name === item.name ? "selected" : ""}`}
                type="button"
                key={item.name}
                onClick={() => open(item.name)}
              >
                <strong>{item.name}</strong>
                <small>{item.custom ? "Custom" : "Standard"}</small>
              </button>
            ))}
          </div>
          {objects.length > 300 && (
            <p className="hf-note">
              Showing the first 300 matches. Filter to find a specific object.
            </p>
          )}
        </aside>
        <div className="hf-utility-detail">
          {data ? (
            <>
              <div className="hf-utility-result-heading">
                <div>
                  <h2>{data.label}</h2>
                  <code>{data.name}</code>
                  <span className="hf-badge">{data.fields.length} fields</span>
                </div>
                <button className="hf-button" type="button" onClick={exportDocumentation}>
                  Export field docs ↓
                </button>
              </div>
              <div className="hf-utility-toolbar">
                <label className="hf-field hf-utility-grow">
                  Find field
                  <input
                    value={fieldsSearch}
                    onChange={(event) => setFieldsSearch(event.target.value)}
                    placeholder="Label, API name, or type"
                  />
                </label>
                <button
                  className="hf-button hf-primary"
                  type="button"
                  disabled={selected.length === 0 || !data.queryable}
                  onClick={() =>
                    props.onNavigate("admin-utilities/soql-workspace", {
                      orgId: props.orgId,
                      object: data.name,
                      query: `SELECT ${selected.join(", ")} FROM ${data.name} LIMIT 50`,
                    })
                  }
                >
                  Open query for selected fields →
                </button>
              </div>
              <p className="hf-note">
                {selected.length} selected · {data.queryable ? "Queryable" : "Queries unavailable"}{" "}
                · {data.searchable ? "Searchable" : "Not searchable"}
              </p>
              <div className="hf-utility-table-wrap">
                <table className="hf-utility-table">
                  <thead>
                    <tr>
                      <th>Select</th>
                      <th>Field</th>
                      <th>API name</th>
                      <th>Type</th>
                      <th>Relationship</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((field) => (
                      <tr key={field.name}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${field.label} for query`}
                            checked={selected.includes(field.name)}
                            onChange={(event) =>
                              setSelected((values) =>
                                event.target.checked
                                  ? [...values, field.name]
                                  : values.filter((value) => value !== field.name),
                              )
                            }
                          />
                        </td>
                        <td>{field.label}</td>
                        <td>
                          <code>{field.name}</code>
                        </td>
                        <td>
                          {field.type}
                          {field.length !== null && <small>Length {field.length}</small>}
                        </td>
                        <td>
                          {field.referenceTo.join(", ") || "—"}
                          {field.relationshipName && <small>{field.relationshipName}</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {fields.length === 0 && <Empty>No fields match your search.</Empty>}
              {data.childRelationships.length > 0 && (
                <details className="hf-advanced">
                  <summary>{data.childRelationships.length} child relationships</summary>
                  <div className="hf-utility-table-wrap">
                    <table className="hf-utility-table">
                      <thead>
                        <tr>
                          <th>Child object</th>
                          <th>Field</th>
                          <th>Relationship name</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.childRelationships.map((relation, index) => (
                          <tr key={`${relation.childSObject}:${relation.field}:${index}`}>
                            <td>{relation.childSObject}</td>
                            <td>
                              <code>{relation.field}</code>
                            </td>
                            <td>{relation.relationshipName || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </>
          ) : (
            <Empty>
              Choose an object to read its labels, field types, and relationships. Salesforce
              permissions determine availability.
            </Empty>
          )}
        </div>
      </div>
    </UtilityPanel>
  );
}
