/* oxlint-disable shadcn/no-unknown-classes -- Headful owns this compact appearance control. */
import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

export function AppearanceControl({ idPrefix = "appearance" }: { idPrefix?: string }) {
  const { appearanceMode, setAppearanceMode } = useTheme();
  const [error, setError] = useState(false);
  return (
    <div className="sf-appearance-control">
      <div className="sf-appearance-options" role="group" aria-label="Color mode">
        {(
          [
            ["system", "System", Monitor],
            ["light", "Light", Sun],
            ["dark", "Dark", Moon],
          ] as const
        ).map(([mode, label, Icon]) => (
          <button
            key={mode}
            type="button"
            aria-label={`${label} mode`}
            aria-pressed={appearanceMode === mode}
            data-testid={`${idPrefix}-${mode}`}
            onClick={() => setError(!setAppearanceMode(mode))}
          >
            <Icon size={14} aria-hidden="true" /> <span>{label}</span>
          </button>
        ))}
      </div>
      {error && <p role="alert">Could not save your color mode. Try again.</p>}
    </div>
  );
}

export function AppearanceSettings() {
  return (
    <section className="sf-configuration-page" aria-labelledby="appearance-title">
      <div className="sf-page-title">
        <h2 id="appearance-title">Appearance</h2>
        <p>Choose how Headful looks on this Mac.</p>
      </div>
      <section className="sf-setting-card">
        <div className="sf-setting-card-body">
          <h3>Color mode</h3>
          <p>Follow your Mac’s appearance or choose a light or dark workspace.</p>
          <AppearanceControl />
        </div>
        <footer>Your preference applies to setup, workspace tools, and Settings.</footer>
      </section>
    </section>
  );
}
