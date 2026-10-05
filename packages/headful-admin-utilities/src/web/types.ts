export interface UtilityOrg {
  id: string;
  label: string;
  alias: string;
  color: string;
  isSandbox?: boolean | null | undefined;
  status: string;
  username: string;
  salesforceOrgId: string;
}

export function orgEnvironment(org: Pick<UtilityOrg, "isSandbox">): string {
  return org.isSandbox === true
    ? "Sandbox"
    : org.isSandbox === false
      ? "Production"
      : "Environment unknown";
}

export interface UtilityComponentProps {
  orgId: string;
  workspaceId: string;
  orgs: UtilityOrg[];
  dispatch: (operation: string, input: unknown) => Promise<unknown>;
  onOrgChange: (orgId: string) => void;
  onNavigate: (componentId: string, input?: Record<string, string | number | boolean>) => void;
  onFeedback: (message: string) => void;
  onCommandPalette?: (() => void) | undefined;
  initialInput?: Record<string, string | number | boolean> | undefined;
  actionContributions?:
    | Array<{
        id: string;
        name: string;
        disabled: boolean;
        reason?: string | undefined;
        run: () => void;
      }>
    | undefined;
}
