import {
  Activity,
  Boxes,
  Info,
  Layers,
  Plug,
  Puzzle,
  Terminal,
  Monitor,
  BookOpen,
} from "lucide-react";

export type SettingsPage =
  | "overview"
  | "limits"
  | "metadata"
  | "environments"
  | "connections"
  | "mods"
  | "cli"
  | "appearance"
  | "documentation";
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
        title: "Connections",
        icon: Plug,
        keywords: "setup login salesforce agent access orgs authentication",
      },
      {
        id: "cli",
        title: "Salesforce CLI",
        icon: Terminal,
        keywords: "install update upgrade version executable path setup",
      },
      {
        id: "appearance",
        title: "Appearance",
        icon: Monitor,
        keywords: "theme light dark system color mode",
      },
      {
        id: "documentation",
        title: "Documentation",
        icon: BookOpen,
        keywords: "docs guide help getting started authentication",
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
