import { useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { headfulUtilityResultSchemas } from "@t3tools/contracts/headful-utilities";
import { downloadLocal } from "./data";
import { Empty, UtilityPanel, useUtilityTask } from "./primitives";
import type { UtilityComponentProps } from "./types";
import { CodeEditor } from "./CodeEditor";
import { DocumentView } from "./DocumentView";
import { PaneDivider } from "./PaneDivider";

import { useObjects, type Describe } from "./objects";

export function SchemaExplorer(props: UtilityComponentProps) {
  const list = useObjects(props);
  const [search, setSearch] = useState("");
  const [fieldsSearch, setFieldsSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [data, setData] = useState<Describe | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [fieldName, setFieldName] = useState<string | null>(null);
  const [fieldType, setFieldType] = useState("all");
  const [view, setView] = useState<"fields" | "documentation">("fields");
  const [objectsWidth, setObjectsWidth] = useState(18);
  const [propertiesWidth, setPropertiesWidth] = useState(26);
  const objectFilter = useDeferredValue(search);
  const fieldFilter = useDeferredValue(fieldsSearch);
  const fieldTrigger = useRef<HTMLButtonElement | null>(null);
  const fieldClose = useRef<HTMLButtonElement>(null);
  const task = useUtilityTask();
  useEffect(() => {
    task.reset();
    setData(null);
    setSearch("");
    setFieldsSearch("");
    setSelected([]);
    setFieldName(null);
    return task.reset;
  }, [props.orgId, task.reset]);
  const objects = useMemo(
    () =>
      list.objects.filter(
        (item) =>
          item.name.toLowerCase().includes(objectFilter.toLowerCase()) &&
          (category === "all" || item.custom === (category === "custom")),
      ),
    [list.objects, objectFilter, category],
  );
  const fields = useMemo(
    () =>
      data?.fields.filter(
        (field) =>
          (fieldType !== "formula" || field.calculated) &&
          `${field.name} ${field.label} ${field.type}`
            .toLowerCase()
            .includes(fieldFilter.toLowerCase()),
      ) ?? [],
    [data, fieldType, fieldFilter],
  );
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
        setFieldName(null);
      },
    );
  useEffect(() => {
    if (props.orgId && typeof props.initialInput?.object === "string")
      open(props.initialInput.object);
  }, [props.orgId, props.initialInput?.object]);
  const documentation = (limit?: number) => {
    if (!data) return "";
    const text = (value: string) => value.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
    const visible = limit ? data.fields.slice(0, limit) : data.fields;
    return `# ${text(data.label)} (${data.name})\n\nOrg: ${text(data.org.label)} (${data.org.salesforceOrgId})\n\nRead-only schema from Headful. Salesforce permissions apply.\n\n${visible.length < data.fields.length ? `Showing ${visible.length} of ${data.fields.length} fields. Export field docs includes all readable fields.\n\n` : ""}| Label | API name | Type | Relationships |\n| --- | --- | --- | --- |\n${visible.map((field) => `| ${text(field.label)} | ${field.name} | ${text(field.type)}${field.calculated ? " (calculated)" : ""} | ${text(field.referenceTo.join(", "))}${field.relationshipName ? ` (${text(field.relationshipName)})` : ""} |`).join("\n")}\n`;
  };
  const exportDocumentation = () => {
    if (!data) return;
    const doc = documentation();
    downloadLocal(`${data.name}-fields.md`, doc, "text/markdown;charset=utf-8");
    props.onFeedback("Exported field documentation locally.");
  };
  const inspected = data?.fields.find((field) => field.name === fieldName);
  return (
    <UtilityPanel
      className="hf-schema-workspace"
      title="Objects & fields"
      description="Browse readable fields and relationships. Select fields to build a query."
      busy={task.busy || list.busy}
      error={task.error || list.error}
    >
      <div
        className="hf-utility-split"
        style={
          {
            "--hf-objects-width": `${objectsWidth}%`,
            "--hf-properties-width": `${propertiesWidth}%`,
          } as CSSProperties
        }
      >
        <aside className="hf-utility-object-list" aria-label="Object browser">
          <div className="hf-panel-title">
            <h2>Objects</h2>
            <span className="hf-badge">{objects.length}</span>
          </div>
          <div className="hf-panel-controls">
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
          </div>
          <div
            className="hf-utility-object-options"
            aria-label="Available objects"
            aria-busy={search !== objectFilter}
          >
            {objects.slice(0, 300).map((item) => (
              <button
                className={`hf-utility-object-button ${data?.name === item.name ? "selected" : ""}`}
                type="button"
                key={item.name}
                data-testid={`admin-object-${item.name.toLowerCase()}`}
                aria-pressed={data?.name === item.name}
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
          <div className="hf-panel-status">{objects.length} available · API names</div>
        </aside>
        <PaneDivider
          label="Object browser width"
          value={objectsWidth}
          min={14}
          max={26}
          initial={18}
          onChange={setObjectsWidth}
          testId="admin-objects-divider"
        />
        <div className="hf-utility-detail">
          {data ? (
            <>
              <div className="hf-utility-result-heading">
                <div>
                  <h2>{data.label}</h2>
                  {data.label !== data.name && <code>{data.name}</code>}
                  <span className="hf-badge">{data.fields.length} fields</span>
                </div>
                <div className="hf-schema-view" role="group" aria-label="Object view">
                  <button
                    type="button"
                    data-testid="admin-schema-fields"
                    aria-pressed={view === "fields"}
                    onClick={() => setView("fields")}
                  >
                    Fields
                  </button>
                  <button
                    type="button"
                    data-testid="admin-schema-documentation"
                    aria-pressed={view === "documentation"}
                    onClick={() => setView("documentation")}
                  >
                    Documentation
                  </button>
                </div>
                <button className="hf-button" type="button" onClick={exportDocumentation}>
                  Export docs ↓
                </button>
              </div>
              {view === "documentation" ? (
                <DocumentView
                  title={`${data.name} field documentation`}
                  markdown={documentation(200)}
                  testId="admin-schema-document"
                />
              ) : (
                <>
                  <div className="hf-utility-toolbar">
                    <label className="hf-field hf-utility-grow">
                      Find field
                      <input
                        value={fieldsSearch}
                        onChange={(event) => setFieldsSearch(event.target.value)}
                        placeholder="Label, API name, or type"
                      />
                    </label>
                    <select
                      aria-label="Field kind"
                      value={fieldType}
                      onChange={(event) => setFieldType(event.target.value)}
                    >
                      <option value="all">All fields</option>
                      <option value="formula">Calculated fields</option>
                    </select>
                    <button
                      className="hf-button hf-primary"
                      type="button"
                      data-testid="admin-open-query"
                      aria-description="Opens an unexecuted query using the selected fields."
                      disabled={selected.length === 0 || !data.queryable}
                      onClick={() =>
                        props.onNavigate("headful.admin-utilities/soql-workspace", {
                          orgId: props.orgId,
                          object: data.name,
                          query: `SELECT ${selected.join(", ")} FROM ${data.name} LIMIT 50`,
                        })
                      }
                    >
                      Query selected ({selected.length}) →
                    </button>
                  </div>
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
                          <tr
                            key={field.name}
                            data-selected={fieldName === field.name || undefined}
                          >
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
                            <td>
                              <button
                                className="hf-utility-link"
                                type="button"
                                data-testid={`admin-inspect-field-${field.name.toLowerCase().replaceAll("_", "-")}`}
                                aria-label={`Inspect ${field.name}`}
                                aria-pressed={fieldName === field.name}
                                onClick={(event) => {
                                  fieldTrigger.current = event.currentTarget;
                                  setFieldName(field.name);
                                  requestAnimationFrame(() => {
                                    fieldTrigger.current?.scrollIntoView?.({
                                      block: "nearest",
                                      inline: "nearest",
                                    });
                                    fieldClose.current?.focus({ preventScroll: true });
                                  });
                                }}
                              >
                                {field.label}
                              </button>
                            </td>
                            <td>
                              <code>{field.name}</code>
                            </td>
                            <td>
                              {field.type}
                              {field.calculated && <small>Calculated</small>}
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
                  <div className="hf-panel-status">
                    {fields.length} of {data.fields.length} fields · {selected.length} selected ·{" "}
                    {data.queryable ? "Queryable" : "Queries unavailable"} ·{" "}
                    {data.searchable ? "Searchable" : "Not searchable"}
                  </div>
                </>
              )}
            </>
          ) : (
            <Empty>
              Choose an object to read its labels, field types, and relationships. Salesforce
              permissions determine availability.
            </Empty>
          )}
        </div>
        {view === "fields" && inspected && data && (
          <>
            <PaneDivider
              label="Field properties width"
              value={propertiesWidth}
              min={22}
              max={38}
              initial={26}
              onChange={setPropertiesWidth}
              edge="end"
              testId="admin-properties-divider"
            />
            <aside className="hf-field-inspector" aria-label="Field inspector">
              <div className="hf-field-inspector-heading">
                <h2>Properties</h2>
                <button
                  type="button"
                  className="hf-button"
                  ref={fieldClose}
                  aria-label="Close field inspector"
                  onClick={() => {
                    setFieldName(null);
                    requestAnimationFrame(() => fieldTrigger.current?.focus());
                  }}
                >
                  ×
                </button>
              </div>
              <div className="hf-field-inspector-body" key={inspected.name}>
                <nav className="hf-property-path" aria-label="Field breadcrumb">
                  <span>{data.name}</span>
                  <span aria-current="page">{inspected.name}</span>
                </nav>
                <h2>{inspected.label}</h2>
                <details className="hf-property-group" open>
                  <summary>Field details</summary>
                  <dl>
                    <dt>API name</dt>
                    <dd>
                      <code>{inspected.name}</code>
                    </dd>
                    <dt>Type</dt>
                    <dd>
                      {inspected.type}
                      {inspected.length !== null ? ` · ${inspected.length} characters` : ""}
                    </dd>
                    <dt>Value</dt>
                    <dd>
                      {inspected.calculated
                        ? "Calculated by Salesforce"
                        : inspected.nillable
                          ? "Can be empty"
                          : "Required"}
                    </dd>
                    <dt>Access</dt>
                    <dd>
                      {inspected.createable ? "Create" : "No create"} ·{" "}
                      {inspected.updateable ? "Update" : "Read only"}
                    </dd>
                    {inspected.referenceTo.length > 0 && (
                      <>
                        <dt>References</dt>
                        <dd>{inspected.referenceTo.join(", ")}</dd>
                      </>
                    )}
                  </dl>
                </details>
                {inspected.calculated && (
                  <details
                    className="hf-property-group hf-field-formula"
                    aria-label="Formula source"
                    open
                  >
                    <summary>Formula source</summary>
                    {inspected.calculatedFormula ? (
                      <CodeEditor
                        value={inspected.calculatedFormula}
                        language="formula"
                        readOnly
                        label={`${inspected.name} formula`}
                        testId="admin-field-formula"
                      />
                    ) : (
                      <p>Salesforce did not return formula source for this calculated field.</p>
                    )}
                  </details>
                )}
                {inspected.picklistValues.length > 0 && (
                  <details className="hf-property-group" open>
                    <summary>
                      Picklist values{" "}
                      <span className="hf-badge">{inspected.picklistValues.length}</span>
                    </summary>
                    <ul>
                      {inspected.picklistValues.map((value) => (
                        <li key={value.value}>
                          {value.label} <code>{value.value}</code>
                          {!value.active ? " · Inactive" : ""}
                          {value.defaultValue ? " · Default" : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </aside>
          </>
        )}
      </div>
    </UtilityPanel>
  );
}
