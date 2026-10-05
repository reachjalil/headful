import { useEffect, useState } from "react";
import { headfulUtilityResultSchemas } from "@t3tools/contracts/headful-utilities";
import { copyLocal } from "./data";
import { Empty, UtilityPanel, useUtilityTask } from "./primitives";
import { orgEnvironment, type UtilityComponentProps } from "./types";
import type { z } from "zod";

type Favorites = z.infer<(typeof headfulUtilityResultSchemas)["utilities.favorites.list"]>;
type Destination = "home" | "setup" | "users" | "permission-sets" | "object-manager" | "record";
const destinations: Array<{ value: Destination; label: string }> = [
  { value: "home", label: "Org home" },
  { value: "setup", label: "Setup" },
  { value: "users", label: "Users" },
  { value: "permission-sets", label: "Permission Sets" },
  { value: "object-manager", label: "Object Manager" },
  { value: "record", label: "Record" },
];

export function OrgCloud({ color }: { color: string }) {
  return (
    <svg
      className="hf-org-cloud"
      style={{ color }}
      viewBox="0 0 32 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 21a6 6 0 0 1-1-12 8 8 0 0 1 15-2 7 7 0 1 1 2 14Z" />
    </svg>
  );
}

export function FavoriteLinks(props: UtilityComponentProps) {
  const [data, setData] = useState<Favorites | null>(null);
  const [open, setOpen] = useState(false);
  const task = useUtilityTask();
  useEffect(() => {
    task.reset();
    setData(null);
    setOpen(false);
    if (props.orgId)
      void task.run(
        async () =>
          headfulUtilityResultSchemas["utilities.favorites.list"].parse(
            await props.dispatch("utilities.favorites.list", { orgId: props.orgId }),
          ),
        setData,
      );
    return task.reset;
  }, [props.orgId, task.run, task.reset, props.dispatch]);
  return (
    <div className="hf-utility-popover">
      <button
        className="hf-button hf-compact"
        type="button"
        aria-expanded={open}
        disabled={!props.orgId}
        onClick={() => setOpen(!open)}
      >
        ☆ Favorites
      </button>
      {open && (
        <div
          className="hf-utility-popover-body"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              (event.currentTarget.previousElementSibling as HTMLButtonElement | null)?.focus();
            }
          }}
        >
          <strong>This org’s shortcuts</strong>
          {task.error && <p role="alert">{task.error}</p>}
          {data?.favorites.map((favorite) => (
            <button
              className="hf-utility-link"
              type="button"
              key={favorite.id}
              onClick={() =>
                void task.run(
                  () =>
                    props.dispatch("utilities.org.open", {
                      orgId: favorite.orgId,
                      destination: favorite.destination,
                      ...(favorite.recordId ? { recordId: favorite.recordId } : {}),
                    }),
                  () => {
                    setOpen(false);
                    props.onFeedback("Opened the shortcut in the selected org.");
                  },
                )
              }
            >
              {favorite.label} ↗
            </button>
          ))}
          {!task.busy && data?.favorites.length === 0 && (
            <p className="hf-note">No favorites yet.</p>
          )}
          <button
            className="hf-utility-link"
            type="button"
            onClick={() => {
              setOpen(false);
              props.onNavigate("admin-utilities/org-shortcuts");
            }}
          >
            Manage shortcuts →
          </button>
        </div>
      )}
    </div>
  );
}

export function OrgShortcuts(props: UtilityComponentProps) {
  const [data, setData] = useState<Favorites | null>(null);
  const [label, setLabel] = useState("");
  const [destination, setDestination] = useState<Destination>("setup");
  const [recordId, setRecordId] = useState("");
  const task = useUtilityTask();
  const load = async () =>
    headfulUtilityResultSchemas["utilities.favorites.list"].parse(
      await props.dispatch("utilities.favorites.list", { orgId: props.orgId }),
    );
  useEffect(() => {
    task.reset();
    setData(null);
    setLabel("");
    setRecordId("");
    if (props.orgId) void task.run(load, setData);
    return task.reset;
  }, [props.orgId, task.run, task.reset]);
  return (
    <UtilityPanel
      title="Org shortcuts"
      description="Switch your workspace target or open a Salesforce Setup page. Favorites stay with the org where you saved them."
      busy={task.busy}
      error={task.error}
      actions={
        props.onCommandPalette && (
          <button className="hf-button" type="button" onClick={props.onCommandPalette}>
            Quick switch ⌘K
          </button>
        )
      }
    >
      <div className="hf-utility-org-grid">
        {props.orgs.map((org) => (
          <article
            className={`hf-utility-org ${org.id === props.orgId ? "selected" : ""}`}
            key={org.id}
          >
            <div className="hf-card-heading">
              <OrgCloud color={org.color} />
              <div className="hf-utility-grow">
                <strong>{org.label}</strong>
                <small>{org.alias || org.username}</small>
              </div>
              <span className="hf-badge">{orgEnvironment(org)}</span>
            </div>
            <dl className="hf-utility-details">
              <div>
                <dt>Verified org</dt>
                <dd>
                  <code>{org.salesforceOrgId}</code>
                </dd>
              </div>
              <div>
                <dt>Authenticated user</dt>
                <dd>{org.username}</dd>
              </div>
              <div>
                <dt>Connection</dt>
                <dd>{org.status}</dd>
              </div>
            </dl>
            <div className="hf-actions">
              <button
                className="hf-button"
                type="button"
                aria-pressed={org.id === props.orgId}
                onClick={() => props.onOrgChange(org.id)}
              >
                {org.id === props.orgId ? "Current workspace org" : "Use in workspace"}
              </button>
              <button
                className="hf-button"
                type="button"
                onClick={() =>
                  void task.run(
                    () =>
                      props.dispatch("utilities.org.open", { orgId: org.id, destination: "home" }),
                    () => props.onFeedback("Opened the selected org."),
                  )
                }
              >
                Open ↗
              </button>
              <button
                className="hf-icon-button"
                type="button"
                aria-label={`Copy ${org.label} org ID`}
                onClick={() => void copyLocal(org.salesforceOrgId, props.onFeedback)}
              >
                ⧉
              </button>
            </div>
          </article>
        ))}
      </div>
      {props.orgs.length === 0 && (
        <Empty>No connected orgs yet. Connect or import an org from Your orgs.</Empty>
      )}
      {props.orgId && (
        <section className="hf-card">
          <h2>Setup shortcuts</h2>
          <div className="hf-actions">
            {destinations
              .filter((item) => item.value !== "record")
              .map((item) => (
                <button
                  className="hf-button"
                  type="button"
                  key={item.value}
                  disabled={task.busy}
                  onClick={() =>
                    void task.run(
                      () =>
                        props.dispatch("utilities.org.open", {
                          orgId: props.orgId,
                          destination: item.value,
                        }),
                      () => props.onFeedback(`Opened ${item.label} in the selected org.`),
                    )
                  }
                >
                  {item.label} ↗
                </button>
              ))}
          </div>
        </section>
      )}
      {props.orgId && (
        <section className="hf-card">
          <h2>Favorites for this org</h2>
          <div className="hf-utility-saved-list">
            {data?.favorites.map((favorite) => (
              <div key={favorite.id}>
                <button
                  className="hf-utility-link"
                  type="button"
                  onClick={() =>
                    void task.run(
                      () =>
                        props.dispatch("utilities.org.open", {
                          orgId: favorite.orgId,
                          destination: favorite.destination,
                          ...(favorite.recordId ? { recordId: favorite.recordId } : {}),
                        }),
                      () => props.onFeedback("Opened the favorite in the selected org."),
                    )
                  }
                >
                  {favorite.label} ↗
                </button>
                <small>{favorite.destination}</small>
                <button
                  className="hf-icon-button"
                  type="button"
                  aria-label={`Remove ${favorite.label} favorite`}
                  disabled={task.busy}
                  onClick={() =>
                    void task.run(async () => {
                      await props.dispatch("utilities.favorites.remove", {
                        orgId: favorite.orgId,
                        id: favorite.id,
                      });
                      return load();
                    }, setData)
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {data?.favorites.length === 0 && (
            <p className="hf-note">Save a destination below. Favorites stay with this exact org.</p>
          )}
          <form
            className="hf-utility-toolbar"
            onSubmit={(event) => {
              event.preventDefault();
              void task.run(
                async () => {
                  await props.dispatch("utilities.favorites.set", {
                    orgId: props.orgId,
                    label,
                    destination,
                    ...(destination === "record" ? { recordId } : {}),
                  });
                  return load();
                },
                (result) => {
                  setData(result);
                  setLabel("");
                  setRecordId("");
                  props.onFeedback("Saved the shortcut for this org.");
                },
              );
            }}
          >
            <label className="hf-field hf-utility-grow">
              Name
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={100}
                required
                placeholder="Useful setup page"
              />
            </label>
            <label className="hf-field">
              Destination
              <select
                value={destination}
                onChange={(event) => setDestination(event.target.value as Destination)}
              >
                {destinations.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            {destination === "record" && (
              <label className="hf-field">
                Record ID
                <input
                  value={recordId}
                  onChange={(event) => setRecordId(event.target.value)}
                  pattern="[A-Za-z0-9]{15}([A-Za-z0-9]{3})?"
                  maxLength={18}
                  required
                />
              </label>
            )}
            <button className="hf-button hf-primary" disabled={task.busy}>
              Save favorite
            </button>
          </form>
        </section>
      )}
    </UtilityPanel>
  );
}
