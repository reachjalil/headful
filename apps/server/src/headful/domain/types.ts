/* Adapted from Headful Cloud (Apache-2.0); see LICENSES/Headful-Cloud-Apache-2.0.txt. */
import type { LocalStore } from "../Store.ts";
import type { CliAdapter } from "../SalesforceCli.ts";
export interface Principal {
  user: { id: string };
  orgIds: string[] | null;
  scopes: string[];
  grantId?: string;
  kind: "desktop" | "mcp";
  source?: "connect";
}
export interface Org {
  id: string;
  owner_id: string;
  application_id: string;
  label: string;
  salesforce_org_id: string;
  salesforce_user_id: string;
  instance_origin: string;
  username: string;
  alias: string;
  color: string;
  agent_enabled: number;
  connection_version: number;
  is_sandbox: number | null;
  organization_name: string | null;
  status: string;
  created_at: number;
}
export interface Env {
  DB: LocalStore;
  cli: CliAdapter;
}
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
