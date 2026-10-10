import type { ExperiencePreviewProps } from "../experience-views";
import { AdminWorkspacePreview } from "../admin-workspace/AdminWorkspacePreview";
export function BackupRecoveryPreview(props: ExperiencePreviewProps) {
  return <AdminWorkspacePreview {...props} experienceId="backup-recovery" step="backup" />;
}
