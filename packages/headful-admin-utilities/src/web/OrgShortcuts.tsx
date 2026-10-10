import { useEffect, useRef, useState } from "react";
import { headfulUtilityResultSchemas } from "@t3tools/contracts/headful-utilities";
import { UtilityPanel, useUtilityTask } from "./primitives";
import { type UtilityComponentProps } from "./types";
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
              props.onNavigate("headful.admin-utilities/org-shortcuts");
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
  const [removing, setRemoving] = useState<string | null>(null);
  const removal = useRef<string | null>(null);
  const scope = useRef(0);
  const task = useUtilityTask();
  const load = async () =>
    headfulUtilityResultSchemas["utilities.favorites.list"].parse(
      await props.dispatch("utilities.favorites.list", { orgId: props.orgId }),
    );
  useEffect(() => {
    scope.current++;
    removal.current = null;
    setRemoving(null);
    task.reset();
    setData(null);
    setLabel("");
    setRecordId("");
    if (props.orgId) void task.run(load, setData);
    return () => {
      scope.current++;
      task.reset();
    };
  }, [props.orgId, task.run, task.reset]);
  const remove = (favorite: Favorites["favorites"][number]) => {
    if (removal.current) return;
    const current = scope.current;
    removal.current = favorite.id;
    setRemoving(favorite.id);
    void task
      .run(
        async () => {
          const receipt = headfulUtilityResultSchemas["utilities.favorites.remove"].parse(
            await props.dispatch("utilities.favorites.remove", {
              orgId: favorite.orgId,
              id: favorite.id,
            }),
          );
          if (!receipt.removed)
            throw new Error("The shortcut was not removed. Check it and try again.");
          return favorite.id;
        },
        (id) => {
          setData(
            (value) =>
              value && { ...value, favorites: value.favorites.filter((item) => item.id !== id) },
          );
          props.onFeedback("Removed the shortcut for this org.");
        },
      )
      .finally(() => {
        if (scope.current !== current) return;
        removal.current = null;
        setRemoving(null);
      });
  };
  return (
    <UtilityPanel
      title="Salesforce Setup shortcuts"
      description="Open a Setup page in this org. Favorites stay with this connection."
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
      {props.orgId && (
        <section className="hf-card">
          <h2>Open in Salesforce</h2>
          <div className="hf-shortcut-list">
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
            {data?.favorites
              .filter((favorite) => favorite.id !== removing)
              .map((favorite) => (
                <div key={favorite.id}>
                  <button
                    className="hf-utility-link"
                    type="button"
                    disabled={task.busy}
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
                    onClick={() => remove(favorite)}
                  >
                    ×
                  </button>
                </div>
              ))}
          </div>
          {removing && (
            <p className="hf-note" role="status">
              Removing shortcut…
            </p>
          )}
          {data?.favorites.length === 0 && (
            <p className="hf-note">Save a destination below. Favorites stay with this exact org.</p>
          )}
          <details className="hf-advanced">
            <summary>Save a shortcut</summary>
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
          </details>
        </section>
      )}
    </UtilityPanel>
  );
}
