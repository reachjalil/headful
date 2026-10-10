import { useState } from "react";
import type { HeadfulModDescriptor } from "@t3tools/contracts/headful-mods";
type Values = Record<string, string | number | boolean>;
export function ModControls({
  mod,
  disabled,
  dispatch,
  run,
}: {
  mod: HeadfulModDescriptor;
  disabled: boolean;
  dispatch: (operation: string, input: unknown) => Promise<unknown>;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [settings, setSettings] = useState<Values>(
      Object.fromEntries(mod.manifest.settings.map((s) => [s.key, s.defaultValue])),
    ),
    [inputs, setInputs] = useState<Record<string, Values>>({});
  const commands = mod.enabled
    ? mod.manifest.contributions.commands.filter((command) => command.parameters.length > 0)
    : [];
  if (mod.manifest.settings.length === 0 && commands.length === 0) return null;
  const field = (
    key: string,
    type: string,
    value: string | number | boolean | undefined,
    change: (value: string | number | boolean) => void,
    secret = false,
    label = key,
  ) => (
    <label key={key}>
      {label}{" "}
      {type === "boolean" ? (
        <input
          disabled={disabled}
          type="checkbox"
          checked={value === true}
          onChange={(e) => change(e.target.checked)}
        />
      ) : (
        <input
          disabled={disabled}
          type={secret ? "password" : type === "number" ? "number" : "text"}
          maxLength={20000}
          value={typeof value === "boolean" ? "" : (value ?? "")}
          onChange={(e) => change(type === "number" ? Number(e.target.value) : e.target.value)}
        />
      )}
    </label>
  );
  return (
    <details>
      <summary>{mod.manifest.settings.length ? "Settings & commands" : "Commands"}</summary>
      {mod.manifest.settings.length > 0 && (
        <>
          <button
            disabled={disabled}
            onClick={() =>
              void run(async () => {
                const result = (await dispatch("mods.settings", { id: mod.manifest.id })) as {
                  values: Values;
                };
                setSettings(result.values);
                return result;
              })
            }
          >
            Load saved settings
          </button>
          {mod.manifest.settings.map((s) =>
            field(
              s.key,
              s.type,
              settings[s.key],
              (value) => setSettings((v) => ({ ...v, [s.key]: value })),
              false,
              s.label,
            ),
          )}
          <button
            disabled={disabled}
            onClick={() =>
              void run(() =>
                dispatch("mods.settings.set", { id: mod.manifest.id, values: settings }),
              )
            }
          >
            Save settings
          </button>
        </>
      )}
      {commands.map((c) => (
        <form
          key={c.id}
          onSubmit={(e) => {
            e.preventDefault();
            const values = inputs[c.id] ?? {};
            // Keep ordinary drafts when a command fails; sensitive inputs remain one-use.
            const secretKeys = new Set(
              c.parameters
                .filter((parameter) => parameter.secret)
                .map((parameter) => parameter.key),
            );
            setInputs((v) => ({
              ...v,
              [c.id]: Object.fromEntries(
                Object.entries(values).filter(([key]) => !secretKeys.has(key)),
              ),
            }));
            void run(() =>
              dispatch("mods.command", { id: mod.manifest.id, command: c.id, input: values }),
            );
          }}
        >
          <h4>{c.name}</h4>
          <p>{c.description}</p>
          {c.parameters.map((p) =>
            field(
              p.key,
              p.type,
              inputs[c.id]?.[p.key],
              (value) => setInputs((v) => ({ ...v, [c.id]: { ...v[c.id], [p.key]: value } })),
              p.secret,
              p.label ?? p.key,
            ),
          )}
          <button disabled={disabled} type="submit">
            {c.name}
          </button>
        </form>
      ))}
    </details>
  );
}
