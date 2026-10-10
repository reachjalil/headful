import type { ComponentType } from "react";
import type { ExperienceFixture, ExperienceId } from "@t3tools/contracts/headful-experiences";

/** Props every isolated development preview accepts. Previews own their labeled fixture banner. */
export interface ExperiencePreviewProps {
  fixture: ExperienceFixture;
  step?: string | undefined;
  onStepChange?: ((step: string) => void) | undefined;
}

type PreviewLoader = () => Promise<ComponentType<ExperiencePreviewProps>>;

/**
 * Development-only preview loaders. Imported dynamically from a DEV branch so that
 * no preview, fixture or dev-only experience chunk exists in a production build.
 */
export const experiencePreviews: Record<Exclude<ExperienceId, "initial">, PreviewLoader> = {
  "backup-recovery": () =>
    import("./backup-recovery/BackupRecoveryPreview").then((m) => m.BackupRecoveryPreview),
  "admin-workspace": () =>
    import("./admin-workspace/AdminWorkspacePreview").then(
      (module) => module.AdminWorkspacePreview,
    ),
  "mod-management": () => import("./mod-previews/ModPreviews").then((m) => m.ModManagementPreview),
  "reference-mod": () => import("./mod-previews/ModPreviews").then((m) => m.ReferenceModPreview),
  "org-settings": () =>
    import("./org-settings/OrgSettingsPreview").then((module) => module.OrgSettingsPreview),
  "salesforce-setup": () => import("./SetupPreview").then((module) => module.SetupPreview),
  "lead-review": () =>
    import("./lead-review/LeadReviewPreview").then((module) => module.LeadReviewPreview),
};
