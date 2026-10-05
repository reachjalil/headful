import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  headfulExtensionInputSchemas,
  headfulExtensionResultSchemas,
  type HeadfulExtensionDescriptor,
} from "@t3tools/contracts/headful-extensions";

type ExtensionOperation =
  | "extensions.list"
  | "extensions.enable"
  | "extensions.disable"
  | "extensions.settings"
  | "extensions.settings.set"
  | "extensions.command"
  | "extensions.surface";
async function dispatch(operation: ExtensionOperation, input: unknown = {}): Promise<unknown> {
  if (!window.headfulBridge) throw new Error("Start Headful on your Mac to manage extensions.");
  headfulExtensionInputSchemas[operation].parse(input);
  return window.headfulBridge.dispatch(operation, input);
}

export function HeadfulExtensions({
  busy,
  action,
  onChanged,
  onSettings,
  focusExtensionId,
}: {
  busy: boolean;
  action: (label: string, run: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
  onSettings: () => void;
  focusExtensionId?: string | undefined;
}) {
  const [extensions, setExtensions] = useState<HeadfulExtensionDescriptor[] | null>(null);
  const [apiVersion, setApiVersion] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [surface, setSurface] = useState<{
    extensionId: string;
    title: string;
    markdown: string;
  } | null>(null);
  const [commandResult, setCommandResult] = useState<{
    extensionId: string;
    message: string;
    values?: Record<string, string | number | boolean> | undefined;
  } | null>(null);
  const load = useCallback(async () => {
    const result = headfulExtensionResultSchemas["extensions.list"].parse(
      await dispatch("extensions.list"),
    );
    setExtensions(result.extensions);
    setApiVersion(result.apiVersion);
  }, []);
  useEffect(() => {
    void action("Reading installed extensions", load);
  }, [action, load]);
  useEffect(() => {
    if (focusExtensionId && extensions)
      document.getElementById(`extension-${focusExtensionId}`)?.scrollIntoView({ block: "start" });
  }, [focusExtensionId, extensions]);
  const toggle = (extension: HeadfulExtensionDescriptor) => {
    setNotice("");
    if (extension.enabled) {
      setSurface(null);
      setCommandResult(null);
    }
    void action(
      `${extension.enabled ? "Disabling" : "Activating"} ${extension.manifest.name}`,
      async () => {
        const operation = extension.enabled ? "extensions.disable" : "extensions.enable";
        const result = headfulExtensionResultSchemas[operation].parse(
          await dispatch(operation, { id: extension.manifest.id }),
        );
        await load();
        await onChanged();
        setNotice(
          result.status === "active"
            ? `${result.manifest.name} is active.`
            : result.status === "disabled"
              ? `${result.manifest.name} is disabled. Its contributed agent capabilities are unavailable; saved Salesforce work is retained.`
              : `${result.manifest.name}: ${result.status}.${result.error ? ` ${result.error.message}` : ""}`,
        );
      },
    );
  };
  const openSurface = (extension: HeadfulExtensionDescriptor, surfaceId: string) => {
    void action(`Opening ${extension.manifest.name}`, async () => {
      const result = headfulExtensionResultSchemas["extensions.surface"].parse(
        await dispatch("extensions.surface", { id: extension.manifest.id, surfaceId }),
      );
      setSurface({ extensionId: extension.manifest.id, ...result });
    });
  };
  const runCommand = (
    extension: HeadfulExtensionDescriptor,
    command: string,
    input: Record<string, string | number | boolean> = {},
  ) => {
    void action(`Running ${extension.manifest.name} command`, async () => {
      const result = headfulExtensionResultSchemas["extensions.command"].parse(
        await dispatch("extensions.command", { id: extension.manifest.id, command, input }),
      );
      setCommandResult({ extensionId: extension.manifest.id, ...result });
      await load();
      await onChanged();
    });
  };
  return (
    <>
      <section className="hf-card">
        <div className="hf-card-heading">
          <div>
            <h2>Installed extensions</h2>
            <p>
              Extend Headful with a compatible local module. Inspect what it contributes and control
              whether it is active.
            </p>
          </div>
          <button
            className="hf-button"
            type="button"
            disabled={busy}
            onClick={() => void action("Refreshing extensions", load)}
          >
            Refresh
          </button>
        </div>
        <p className="hf-note">
          The desktop and Salesforce services are open source. Optional modules have separate
          licenses. The current Mac beta is free; enabling an extension does not grant org access or
          approve a Salesforce change.
        </p>
        {apiVersion !== null && <span className="hf-badge">Extension API {apiVersion}</span>}
      </section>
      {notice && (
        <p className="hf-success" role="status">
          {notice}
        </p>
      )}
      {extensions === null ? (
        <div className="hf-empty">
          <p>
            {busy
              ? "Reading installed extension metadata…"
              : "Extension metadata is unavailable. Refresh to retry."}
          </p>
        </div>
      ) : extensions.length === 0 ? (
        <div className="hf-empty">
          <h2>No installed extensions.</h2>
          <p>
            This build has no bundled extension available. Core org management and Salesforce
            services remain available.
          </p>
        </div>
      ) : (
        extensions.map((extension) => {
          const { manifest } = extension;
          const { contributions } = manifest;
          const groups = [
            {
              name: "Navigation",
              values: contributions.navigation.map(
                (value) => `${value.name} · ${value.componentId}`,
              ),
            },
            {
              name: "Header controls",
              values: contributions.headerControls.map(
                (value) => `${value.name} · ${value.placement}`,
              ),
            },
            {
              name: "Panels",
              values: contributions.panels.map((value) => `${value.name} · ${value.componentId}`),
            },
            {
              name: "Actions",
              values: contributions.actions.map((value) => `${value.name} · ${value.commandId}`),
            },
            {
              name: "Features",
              values: contributions.features.map((value) => `${value.name} · ${value.id}`),
            },
            {
              name: "Routes",
              values: contributions.routes.map((value) => `${value.name} · ${value.path}`),
            },
            {
              name: "Skills",
              values: contributions.skills.map((value) => `${value.name} · ${value.id}`),
            },
            {
              name: "MCP",
              values: contributions.mcp.map(
                (value) => `${value.id} · ${value.transport} · ${value.path}`,
              ),
            },
            { name: "Harnesses", values: contributions.harness.map((value) => value.name) },
            { name: "Lifecycle hooks", values: contributions.hooks },
            { name: "Commands", values: contributions.commands.map((value) => value.name) },
            { name: "Surfaces", values: contributions.surfaces.map((value) => value.name) },
            {
              name: "Desktop operations",
              values: contributions.desktopOperations.map(
                (value) => `${value.id}${value.recovery ? " · recovery" : ""}`,
              ),
            },
          ];
          return (
            <article
              className="hf-card hf-extension-card"
              key={manifest.id}
              id={`extension-${manifest.id}`}
            >
              <div className="hf-card-heading">
                <div>
                  <div className="hf-extension-title">
                    <span className="hf-extension-symbol" aria-hidden="true">
                      ◈
                    </span>
                    <h2>{manifest.name}</h2>
                    <span
                      className={`hf-badge hf-extension-state ${extension.status === "active" ? "hf-extension-state-active" : ""}`}
                    >
                      {extension.status}
                    </span>
                  </div>
                  <p>{manifest.description}</p>
                </div>
                <button
                  className={`hf-button ${extension.enabled ? "" : "hf-primary"}`}
                  type="button"
                  disabled={
                    busy ||
                    (!extension.enabled && !extension.compatible) ||
                    extension.status === "activating"
                  }
                  aria-label={`${extension.enabled ? "Disable" : "Enable"} ${manifest.name}`}
                  onClick={() => toggle(extension)}
                >
                  {extension.enabled ? "Disable extension" : "Enable extension"}
                </button>
              </div>
              {extension.error && (
                <p className="hf-alert" role="alert">
                  <strong>{extension.error.code}</strong> · {extension.error.message}
                </p>
              )}
              <dl className="hf-extension-meta">
                <div>
                  <dt>Version</dt>
                  <dd>{manifest.version}</dd>
                </div>
                <div>
                  <dt>Package</dt>
                  <dd>
                    <code>{manifest.packageName}</code>
                  </dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>
                    {manifest.sourceClassification === "proprietary"
                      ? "Proprietary integration"
                      : "Open-source extension"}{" "}
                    · {manifest.source === "bundled" ? "Bundled with this app" : manifest.source}
                  </dd>
                </div>
                <div>
                  <dt>License</dt>
                  <dd>{manifest.license}</dd>
                </div>
                <div>
                  <dt>Compatibility</dt>
                  <dd>
                    {extension.compatible ? "Compatible" : "Incompatible"} · API{" "}
                    {manifest.apiVersion}
                  </dd>
                </div>
                <div>
                  <dt>Activation</dt>
                  <dd>
                    {extension.enabled ? "Enabled" : "Disabled"} · {extension.status}
                  </dd>
                </div>
              </dl>
              {extension.runtimeStatuses.map((value) => (
                <p className="hf-note" role="status" key={value.id}>
                  {value.label} · {value.state}
                  {value.clientCount === undefined
                    ? ""
                    : ` · ${value.clientCount} connected clients`}
                </p>
              ))}
              {(contributions.surfaces.length > 0 || contributions.commands.length > 0) && (
                <div className="hf-extension-actions">
                  {contributions.surfaces.map((value) => (
                    <button
                      className="hf-button"
                      key={`surface:${value.id}`}
                      type="button"
                      disabled={busy || extension.status !== "active"}
                      title={value.description}
                      onClick={() => openSurface(extension, value.id)}
                    >
                      Open {value.name}
                    </button>
                  ))}
                  {contributions.commands
                    .filter((value) => value.parameters.length === 0)
                    .map((value) => (
                      <button
                        className="hf-button"
                        key={`command:${value.id}`}
                        type="button"
                        disabled={busy || extension.status !== "active"}
                        title={value.description}
                        onClick={() => runCommand(extension, value.id)}
                      >
                        {value.name}
                      </button>
                    ))}
                </div>
              )}
              {contributions.commands
                .filter((command) => command.parameters.length > 0)
                .map((command) => (
                  <ExtensionCommandForm
                    key={command.id}
                    command={command}
                    disabled={busy || extension.status !== "active"}
                    onRun={(input) => runCommand(extension, command.id, input)}
                  />
                ))}
              {surface?.extensionId === manifest.id && (
                <section className="hf-extension-output" aria-label={surface.title}>
                  <div className="hf-card-heading">
                    <h3>{surface.title}</h3>
                    <button className="hf-button" type="button" onClick={() => setSurface(null)}>
                      Close
                    </button>
                  </div>
                  <pre>{surface.markdown}</pre>
                </section>
              )}
              {commandResult?.extensionId === manifest.id && (
                <section
                  className="hf-extension-output"
                  aria-label="Extension command result"
                  role="status"
                >
                  <p>{commandResult.message}</p>
                  {commandResult.values && (
                    <dl className="hf-about">
                      {Object.entries(commandResult.values).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </section>
              )}
              <details className="hf-advanced hf-extension-details">
                <summary>
                  Declared contributions ·{" "}
                  {groups.reduce((count, group) => count + group.values.length, 0)}
                </summary>
                <div className="hf-extension-contributions">
                  {groups
                    .filter((group) => group.values.length > 0)
                    .map((group) => (
                      <div key={group.name}>
                        <h3>{group.name}</h3>
                        <ul>
                          {group.values.map((value) => (
                            <li key={value}>{value}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
                {!groups.some((group) => group.values.length > 0) && (
                  <p>No contributions declared.</p>
                )}
                <h3>Declared capabilities</h3>
                <p>
                  {manifest.permissions.length
                    ? manifest.permissions.join(" · ")
                    : "No additional capabilities declared."}
                </p>
                <p>
                  These declarations describe module capabilities. Your org/client grants and exact
                  human review still govern Salesforce operations.
                </p>
                <h3>Dependencies</h3>
                <p>
                  {manifest.dependencies.length
                    ? manifest.dependencies
                        .map((value) => `${value.id}${value.version ? ` @ ${value.version}` : ""}`)
                        .join(" · ")
                    : "No extension dependencies."}
                </p>
                {manifest.requiredFeatures.length > 0 && (
                  <p>
                    Required features: {manifest.requiredFeatures.join(" · ")}.{" "}
                    <button className="hf-link-button" type="button" onClick={onSettings}>
                      Open feature settings
                    </button>
                  </p>
                )}
                {manifest.settings.length > 0 && (
                  <ExtensionSettings
                    extension={extension}
                    busy={busy}
                    action={action}
                    onSaved={async () => {
                      await load();
                      await onChanged();
                    }}
                  />
                )}
              </details>
            </article>
          );
        })
      )}
      <p className="hf-note">
        This release manages modules already bundled with Headful. A marketplace and arbitrary npm
        package installation are outside this first integration. The module license and notices ship
        with the app.
      </p>
    </>
  );
}

function ExtensionSettings({
  extension,
  busy,
  action,
  onSaved,
}: {
  extension: HeadfulExtensionDescriptor;
  busy: boolean;
  action: (label: string, run: () => Promise<void>) => Promise<void>;
  onSaved: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string | number | boolean> | null>(null);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const read = () =>
    void action(`Reading ${extension.manifest.name} settings`, async () => {
      const result = headfulExtensionResultSchemas["extensions.settings"].parse(
        await dispatch("extensions.settings", { id: extension.manifest.id }),
      );
      setValues(result.values);
      setRevision((value) => value + 1);
      setNotice("");
    });
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next: Record<string, string | number | boolean> = {};
    for (const setting of extension.manifest.settings) {
      const raw = data.get(setting.key);
      next[setting.key] =
        setting.type === "boolean"
          ? data.has(setting.key)
          : setting.type === "number"
            ? Number(raw)
            : typeof raw === "string"
              ? raw
              : "";
    }
    void action(`Saving ${extension.manifest.name} settings`, async () => {
      const result = headfulExtensionResultSchemas["extensions.settings.set"].parse(
        await dispatch("extensions.settings.set", { id: extension.manifest.id, values: next }),
      );
      setValues(result.values);
      setRevision((value) => value + 1);
      await onSaved();
      setNotice(
        "Extension settings saved. Salesforce access and reviewed workflows are unchanged.",
      );
    });
  };
  return (
    <section className="hf-extension-settings">
      <div className="hf-card-heading">
        <h3>Extension settings</h3>
        <button className="hf-button" type="button" disabled={busy} onClick={read}>
          {values ? "Refresh settings" : "Read settings"}
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {values && (
        <form key={revision} onSubmit={save}>
          {extension.manifest.settings.map((setting) => {
            const value = values[setting.key] ?? setting.defaultValue;
            return setting.type === "boolean" ? (
              <label className="hf-feature" key={setting.key}>
                <span>
                  <strong>{setting.label}</strong>
                  <small>{setting.key}</small>
                </span>
                <input
                  type="checkbox"
                  name={setting.key}
                  disabled={busy}
                  defaultChecked={value === true}
                />
              </label>
            ) : (
              <label className="hf-field" key={setting.key}>
                {setting.label}
                <input
                  name={setting.key}
                  type={setting.type === "number" ? "number" : "text"}
                  step={setting.type === "number" ? "any" : undefined}
                  maxLength={setting.type === "string" ? 2000 : undefined}
                  required={setting.type === "number"}
                  disabled={busy}
                  defaultValue={String(value)}
                />
              </label>
            );
          })}
          <div className="hf-actions">
            <button className="hf-button hf-primary" type="submit" disabled={busy}>
              Save extension settings
            </button>
            <button className="hf-button" type="reset" disabled={busy}>
              Reset draft
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function ExtensionCommandForm({
  command,
  disabled,
  onRun,
}: {
  command: HeadfulExtensionDescriptor["manifest"]["contributions"]["commands"][number];
  disabled: boolean;
  onRun: (input: Record<string, string | number | boolean>) => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const input: Record<string, string | number | boolean> = {};
    for (const parameter of command.parameters) {
      const value = data.get(parameter.key);
      if (parameter.type === "boolean") input[parameter.key] = data.has(parameter.key);
      else if (typeof value === "string" && (value.length > 0 || parameter.required))
        input[parameter.key] = parameter.type === "number" ? Number(value) : value;
    }
    // Secrets are one-use command inputs, never settings or persisted form defaults.
    for (const parameter of command.parameters)
      if (parameter.secret) {
        const control = form.elements.namedItem(parameter.key);
        if (control instanceof HTMLInputElement) control.value = "";
      }
    onRun(input);
  };
  return (
    <details className="hf-advanced">
      <summary>{command.name}</summary>
      <p>{command.description}</p>
      <form onSubmit={submit} autoComplete="off">
        {command.parameters.map((parameter) => (
          <label className="hf-field" key={parameter.key}>
            {parameter.label ?? parameter.key}
            <input
              name={parameter.key}
              type={
                parameter.type === "boolean"
                  ? "checkbox"
                  : parameter.secret
                    ? "password"
                    : parameter.type === "number"
                      ? "number"
                      : "text"
              }
              required={parameter.required}
              disabled={disabled}
              maxLength={parameter.type === "string" ? 2000 : undefined}
              step={parameter.type === "number" ? "any" : undefined}
            />
            {parameter.description && <small>{parameter.description}</small>}
          </label>
        ))}
        <button className="hf-button hf-primary" type="submit" disabled={disabled}>
          {command.name}
        </button>
      </form>
    </details>
  );
}
