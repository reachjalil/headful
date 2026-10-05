import { useEffect, useState } from "react";
import { useTheme } from "../hooks/useTheme";
import {
  getStandardThemeColors,
  getThemeDefinition,
  installCustomTheme,
  type ThemeColors,
  type ThemeDefinition,
} from "../themePalette";

const light: ThemeColors = {
  ...getStandardThemeColors("light"),
  canvas: "#f6f7fb",
  chrome: "#f6f7fb",
  toolbar: "#f6f7fb",
  toolbarForeground: "#23314c",
  toolbarBorder: "#e1e5ef",
  toolbarControl: "#ffffff",
  toolbarControlForeground: "#23314c",
  toolbarControlHover: "#eef0f8",
  surface: "#ffffff",
  surfaceRaised: "#ffffff",
  surfaceOverlay: "#ffffff",
  text: "#23314c",
  textMuted: "#68758d",
  border: "#e1e5ef",
  input: "#cbd1e0",
  focus: "#626dd2",
  accent: "#626dd2",
  accentForeground: "#ffffff",
  secondary: "#eef0f8",
  secondaryForeground: "#23314c",
  muted: "#f0f2f8",
  mutedForeground: "#68758d",
  placeholder: "#68758d",
  secondaryLabel: "#68758d",
  iconMuted: "#68758d",
  update: "#626dd2",
  updateForeground: "#505db7",
  updateSurface: "#eeeffc",
  accentSurface: "#eeeffc",
  accentSurfaceForeground: "#3e479e",
  messageSurface: "#eef0f8",
  messageForeground: "#23314c",
  messageAction: "#626dd2",
  messageActionForeground: "#ffffff",
  messageActionHover: "#505db7",
  codeBackground: "#ffffff",
  codeForeground: "#23314c",
  sidebar: "#eef0f8",
  sidebarForeground: "#23314c",
  sidebarMutedForeground: "#68758d",
  sidebarControlSurface: "#e6e9f3",
  sidebarRowHover: "#e6e9f3",
  sidebarRowActive: "#ffffff",
  sidebarRowSelected: "#e1e5fa",
  sidebarBorder: "#dbe0ed",
  terminalBackground: "#f6f7fb",
  terminalForeground: "#23314c",
  terminalCursor: "#626dd2",
  terminalSelection: "#dce0f5",
  terminalScrollbar: "#cbd1e0",
  terminalScrollbarHover: "#9da8bd",
};
const dark: ThemeColors = {
  ...getStandardThemeColors("dark"),
  canvas: "#151d2e",
  chrome: "#151d2e",
  toolbar: "#151d2e",
  toolbarForeground: "#e9edf8",
  toolbarBorder: "#303c55",
  toolbarControl: "#23314c",
  toolbarControlForeground: "#e9edf8",
  toolbarControlHover: "#303c55",
  surface: "#1b263c",
  surfaceRaised: "#23314c",
  surfaceOverlay: "#23314c",
  text: "#e9edf8",
  textMuted: "#aab5ce",
  border: "#303c55",
  input: "#46536e",
  focus: "#a8b0ff",
  accent: "#a8b0ff",
  accentForeground: "#18213a",
  secondary: "#273650",
  secondaryForeground: "#e9edf8",
  muted: "#23314c",
  mutedForeground: "#aab5ce",
  placeholder: "#aab5ce",
  secondaryLabel: "#aab5ce",
  iconMuted: "#aab5ce",
  update: "#a8b0ff",
  updateForeground: "#b7beff",
  updateSurface: "#303758",
  accentSurface: "#303758",
  accentSurfaceForeground: "#c8ceff",
  messageSurface: "#273650",
  messageForeground: "#e9edf8",
  messageAction: "#a8b0ff",
  messageActionForeground: "#18213a",
  messageActionHover: "#c0c6ff",
  codeBackground: "#151d2e",
  codeForeground: "#e9edf8",
  sidebar: "#11182b",
  sidebarForeground: "#e9edf8",
  sidebarMutedForeground: "#aab5ce",
  sidebarControlSurface: "#23314c",
  sidebarRowHover: "#1b263c",
  sidebarRowActive: "#273650",
  sidebarRowSelected: "#303758",
  sidebarBorder: "#303c55",
  terminalBackground: "#11182b",
  terminalForeground: "#e9edf8",
  terminalCursor: "#d4ed8b",
  terminalSelection: "#3b4267",
  terminalScrollbar: "#46536e",
  terminalScrollbarHover: "#697792",
};
export const HEADFUL_CHAT_THEME: ThemeDefinition = {
  id: "headful",
  label: "Headful",
  appearance: "light",
  colors: light,
  variants: { dark },
};

/** Desktop-only adapter: stock/shared palettes and the mobile default remain untouched. */
export function HeadfulThemeAdapter() {
  const { setTheme, refreshTheme } = useTheme();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (!getThemeDefinition(HEADFUL_CHAT_THEME.id)) installCustomTheme(HEADFUL_CHAT_THEME);
      if (window.localStorage.getItem("headful.chat.theme-initialized") !== "1") {
        if (!setTheme(HEADFUL_CHAT_THEME.id)) throw new Error("Could not save the Headful theme.");
        window.localStorage.setItem("headful.chat.theme-initialized", "1");
      } else refreshTheme({ preservePreview: true });
    } catch {
      setError(
        "The Headful theme could not be saved. Chat remains available; retry in Appearance settings.",
      );
    }
  }, [setTheme, refreshTheme]);
  return error ? (
    <p className="hf-chat-theme-error" role="status">
      {error}
    </p>
  ) : null;
}
