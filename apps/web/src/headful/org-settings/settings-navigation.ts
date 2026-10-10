import { Activity, Boxes, Info, Layers, Plug, Puzzle } from "lucide-react";

export type SettingsPage =
  | "overview"
  | "limits"
  | "metadata"
  | "environments"
  | "connections"
  | "mods";
export const pageGroups = [
  {
    title: "Selected org",
    pages: [
      { id: "overview", title: "Overview", icon: Info, keywords: "identity edition instance" },
      {
        id: "limits",
        title: "Licenses & usage",
        icon: Activity,
        keywords: "capacity storage limits api",
      },
      {
        id: "metadata",
        title: "Metadata",
        icon: Boxes,
        keywords: "objects fields apex flows components",
      },
      {
        id: "environments",
        title: "Environments",
        icon: Layers,
        keywords: "sandbox scratch expiry",
      },
    ],
  },
  {
    title: "This Mac",
    pages: [
      {
        id: "connections",
        title: "Connections & CLI",
        icon: Plug,
        keywords: "setup login salesforce agent access",
      },
      {
        id: "mods",
        title: "Local mods",
        icon: Puzzle,
        keywords: "install permissions tools extensions",
      },
    ],
  },
] as const;

export const settingsPageTitles: Record<SettingsPage, string> = Object.fromEntries(
  pageGroups.flatMap((group) => group.pages.map((page) => [page.id, page.title])),
) as Record<SettingsPage, string>;
