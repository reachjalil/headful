/**
 * The single list of Headful experiences that exist in code.
 *
 * Plain data with no dependencies, so the shell, native control protocol, browser
 * evidence runner and private experience lab all read the same ids, fixtures,
 * steps and exposure. Hidden experiences in the lab have no entry until designed.
 *
 * exposure:
 * - enabled: composed into normal startup.
 * - dev-only: reachable only as an isolated development entry point.
 */
export const experienceFixtures = ["ready", "missing", "unsupported", "empty", "expired"] as const;
export type ExperienceFixture = (typeof experienceFixtures)[number];
/** Literal data-testid values, including namespaced mod contributions; no selector syntax. */
export const experienceControlTestIdPattern = /^[a-z][a-z0-9./-]{0,159}$/;

export interface ExperienceDefinition {
  /** Persistent experience record in the private lab. */
  readonly record: string;
  readonly exposure: "enabled" | "dev-only";
  readonly fixtures: readonly ExperienceFixture[];
  /** Ordered visible steps; the first is where `flow` starts. */
  readonly steps: readonly string[];
  /** Files whose content binds browser evidence to a source digest. */
  readonly sources: readonly string[];
  /** Canonical saved recipe for this experience. */
  readonly recipe: string;
}

const shell = [
  "apps/web/src/main.tsx",
  "apps/web/src/headful/HeadfulShell.tsx",
  "apps/web/src/headful/experience-control.ts",
  "apps/web/src/headful/experience-views.ts",
  "packages/contracts/src/headful-experiences.ts",
];

export const headfulExperiences = {
  "backup-recovery": {
    record: "backup-recovery",
    exposure: "dev-only",
    fixtures: experienceFixtures,
    steps: ["backup"],
    sources: [
      ...shell,
      "packages/headful-admin-utilities/src/web/BackupRecovery.tsx",
      "apps/web/src/headful/backup-recovery/BackupRecoveryPreview.tsx",
      "packages/contracts/src/headful-utilities.ts",
      "apps/server/src/headful/UtilityService.ts",
    ],
    recipe: "apps/web/src/headful/backup-recovery/backup-recovery.recipe",
  },
  "admin-workspace": {
    record: "admin-workspace",
    exposure: "enabled",
    fixtures: experienceFixtures,
    steps: ["schema", "query", "record", "health", "backup", "shortcuts"],
    sources: [
      ...shell,
      "apps/web/src/headful/WorkspaceSidebar.tsx",
      "apps/web/src/headful/workspace-theme.css",
      "apps/web/src/headful/Appearance.tsx",
      "apps/web/src/headful/CliSetup.tsx",
      "apps/web/src/headful/SetupGuide.tsx",
      "apps/web/src/headful/admin-workspace/AdminWorkspace.tsx",
      "apps/web/src/headful/admin-workspace/editor-contributions.ts",
      "apps/web/src/headful/admin-workspace/EditorToolMenu.tsx",
      "apps/web/src/headful/admin-workspace/EditorModView.tsx",
      "packages/contracts/src/headful-mods.ts",
      "packages/headful-admin-utilities/headful.mod.json",
      "apps/web/src/headful/admin-workspace/admin-workspace.css",
      "apps/web/src/headful/admin-workspace/fixtures.ts",
      "apps/web/src/headful/admin-workspace/AdminWorkspacePreview.tsx",
      "apps/web/src/headful/SalesforceSetup.tsx",
      "apps/web/src/headful/OrgSwitcher.tsx",
      "apps/web/src/headful/salesforce-setup.css",
      "packages/headful-admin-utilities/src/web/index.tsx",
      "packages/headful-admin-utilities/src/web/primitives.tsx",
      "packages/headful-admin-utilities/src/web/SchemaExplorer.tsx",
      "packages/headful-admin-utilities/src/web/SoqlWorkspace.tsx",
      "packages/headful-admin-utilities/src/web/CodeEditor.tsx",
      "packages/headful-admin-utilities/src/web/CodeEditorSurface.tsx",
      "packages/headful-admin-utilities/src/web/LazySurface.tsx",
      "packages/headful-admin-utilities/src/web/objects.ts",
      "packages/headful-admin-utilities/src/web/DocumentView.tsx",
      "packages/headful-admin-utilities/src/web/PaneDivider.tsx",
      "packages/headful-admin-utilities/src/web/PanelTabs.tsx",
      "packages/headful-admin-utilities/src/web/PanelLayout.tsx",
      "scripts/headful-editor-manipulation-journey.mjs",
      "packages/headful-admin-utilities/src/web/DocumentPreview.tsx",
      "apps/web/src/headful/admin-workspace/WorkspaceQueries.ts",
      "apps/web/src/headful/org-settings/settings-navigation.ts",
      "apps/web/package.json",
      "packages/contracts/src/headful-utilities.ts",
      "apps/server/src/headful/UtilityService.ts",
      "packages/headful-admin-utilities/package.json",
      "pnpm-lock.yaml",
      "packages/headful-admin-utilities/src/web/RecordInspector.tsx",
      "packages/headful-admin-utilities/src/web/Diagnostics.tsx",
      "packages/headful-admin-utilities/src/web/OrgShortcuts.tsx",
      "apps/web/src/headful/workspace-shell.css",
    ],
    recipe: "apps/web/src/headful/admin-workspace/admin-workspace.recipe",
  },
  "mod-management": {
    record: "mod-management",
    exposure: "enabled",
    fixtures: ["ready", "empty", "expired"],
    steps: ["inspect", "permissions"],
    sources: [
      ...shell,
      "apps/web/src/headful/HeadfulMods.tsx",
      "apps/web/src/headful/ModControls.tsx",
      "apps/web/src/headful/org-settings/org-settings.css",
      "apps/web/src/headful/salesforce-setup.css",
      "apps/web/src/headful/mod-previews/ModPreviews.tsx",
    ],
    recipe: "apps/web/src/headful/mod-previews/mod-management.recipe",
  },
  "reference-mod": {
    record: "reference-mod",
    exposure: "dev-only",
    fixtures: ["ready"],
    steps: ["counter"],
    sources: [
      ...shell,
      "apps/web/src/headful/mod-previews/ModPreviews.tsx",
      "packages/headful-admin-utilities/src/web/RecordInspector.tsx",
      "examples/hello-mod/src/index.ts",
      "examples/hello-mod/headful.mod.json",
      "apps/web/src/headful/WorkspaceSidebar.tsx",
      "apps/web/src/headful/workspace-theme.css",
      "apps/web/src/headful/Appearance.tsx",
      "apps/web/src/headful/CliSetup.tsx",
      "apps/web/src/headful/SetupGuide.tsx",
      "apps/web/src/headful/admin-workspace/AdminWorkspace.tsx",
      "apps/web/src/headful/admin-workspace/editor-contributions.ts",
      "apps/web/src/headful/admin-workspace/EditorToolMenu.tsx",
      "apps/web/src/headful/admin-workspace/EditorModView.tsx",
      "apps/web/src/headful/admin-workspace/AdminWorkspacePreview.tsx",
      "packages/headful-admin-utilities/src/web/CodeEditor.tsx",
      "packages/headful-admin-utilities/src/web/CodeEditorSurface.tsx",
      "packages/headful-admin-utilities/src/web/LazySurface.tsx",
      "packages/headful-admin-utilities/src/web/objects.ts",
      "packages/headful-admin-utilities/src/web/DocumentView.tsx",
      "packages/headful-admin-utilities/src/web/PaneDivider.tsx",
      "packages/headful-admin-utilities/src/web/PanelTabs.tsx",
      "packages/headful-admin-utilities/src/web/PanelLayout.tsx",
      "scripts/headful-editor-manipulation-journey.mjs",
      "packages/headful-admin-utilities/src/web/DocumentPreview.tsx",
      "apps/web/src/headful/admin-workspace/WorkspaceQueries.ts",
      "apps/web/src/headful/org-settings/settings-navigation.ts",
      "apps/web/package.json",
      "packages/headful-admin-utilities/package.json",
      "pnpm-lock.yaml",
      "apps/web/src/headful/admin-workspace/fixtures.ts",
      "apps/web/src/headful/admin-workspace/admin-workspace.css",
      "packages/contracts/src/headful-mods.ts",
      "packages/headful-admin-utilities/headful.mod.json",
    ],
    recipe: "apps/web/src/headful/mod-previews/reference-mod.recipe",
  },
  "org-settings": {
    record: "org-settings",
    exposure: "enabled",
    fixtures: experienceFixtures,
    steps: [
      "overview",
      "limits",
      "metadata",
      "environments",
      "connections",
      "cli",
      "appearance",
      "documentation",
      "mods",
    ],
    sources: [
      ...shell,
      "apps/web/src/headful/WorkspaceSidebar.tsx",
      "apps/web/src/headful/workspace-theme.css",
      "apps/web/src/headful/Appearance.tsx",
      "apps/web/src/headful/CliSetup.tsx",
      "apps/web/src/headful/SetupGuide.tsx",
      "apps/web/src/headful/org-settings/OrgSettings.tsx",
      "apps/web/src/headful/org-settings/SettingsDisclosure.tsx",
      "apps/web/src/headful/HeadfulMods.tsx",
      "apps/web/src/headful/ModControls.tsx",
      "apps/web/src/headful/org-settings/Licenses.tsx",
      "apps/web/src/headful/org-settings/read.tsx",
      "apps/web/src/headful/org-settings/limit-info.ts",
      "apps/web/src/headful/org-settings/OrgSettingsPreview.tsx",
      "apps/web/src/headful/org-settings/fixtures.ts",
      "apps/web/src/headful/org-settings/org-settings.css",
      "apps/web/src/headful/SalesforceSetup.tsx",
      "apps/web/src/headful/OrgSwitcher.tsx",
      "apps/server/src/headful/OrgInsights.ts",
      "apps/server/src/headful/SalesforceCli.ts",
      "apps/server/src/headful/OrgService.ts",
      "apps/server/src/headful/WorkspaceService.ts",
      "packages/contracts/src/headful.ts",
      "packages/contracts/src/headful-org-insights.ts",
    ],
    recipe: "apps/web/src/headful/org-settings/org-settings.recipe",
  },
  initial: {
    record: "initial",
    exposure: "dev-only",
    fixtures: experienceFixtures,
    steps: ["open-window"],
    sources: shell,
    recipe: "apps/web/src/headful/initial.recipe",
  },
  "salesforce-setup": {
    record: "onboarding",
    exposure: "enabled",
    fixtures: experienceFixtures,
    steps: ["welcome", "cli", "orgs", "workspace"],
    sources: [
      ...shell,
      "apps/web/src/headful/SalesforceSetup.tsx",
      "apps/web/src/headful/OrgSwitcher.tsx",
      "apps/web/src/headful/SetupPreview.tsx",
      "apps/web/src/headful/setup-fixtures.ts",
      "apps/web/src/headful/setup-service.ts",
      "apps/web/src/headful/admin-workspace/fixtures.ts",
      "apps/web/src/headful/salesforce-setup.css",
    ],
    recipe: "apps/web/src/headful/salesforce-setup.recipe",
  },
  "lead-review": {
    record: "lead-review",
    exposure: "dev-only",
    fixtures: ["ready", "empty", "expired"],
    steps: ["list", "detail"],
    sources: [
      ...shell,
      "apps/web/src/headful/lead-review/LeadReview.tsx",
      "apps/web/src/headful/lead-review/LeadReviewPreview.tsx",
      "apps/web/src/headful/lead-review/fixtures.ts",
      "apps/web/src/headful/lead-review/lead-review.css",
    ],
    recipe: "apps/web/src/headful/lead-review/lead-review.recipe",
  },
} as const satisfies Record<string, ExperienceDefinition>;

export type ExperienceId = keyof typeof headfulExperiences;
export const experienceIds = Object.keys(headfulExperiences) as [ExperienceId, ...ExperienceId[]];
