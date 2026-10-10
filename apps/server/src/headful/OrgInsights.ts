import { z } from "zod";
import { HEADFUL_SALESFORCE_API_VERSION } from "@t3tools/contracts/headful";
import {
  canonicalIdentity,
  directRequest,
  publicOrg,
  verifiedOrgSession,
  withVerifiedRead,
} from "./OrgService.ts";
import type { CliAdapter } from "./SalesforceCli.ts";
import type { Org } from "./domain/types.ts";
import { HttpError } from "./domain/types.ts";
import { currentIso } from "./domain/security.ts";

const sfId = z.string().regex(/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/);
const apiName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/);
const nullable = z
  .string()
  .nullish()
  .transform((value) => value ?? null);
const checked = (org: Org) => ({
  org: publicOrg(org),
  checkedAt: currentIso(),
  bounded: true as const,
});

/** Fixed read-only queries and CLI commands. Every read verifies the saved org and principal. */
export class OrgInsights {
  private readonly cli: CliAdapter;
  constructor(cli: CliAdapter) {
    this.cli = cli;
  }
  private async query<T extends z.ZodType>(
    org: Org,
    soql: string,
    schema: T,
    tooling = false,
    read?: (path: string) => Promise<unknown>,
  ) {
    const path = `/services/data/v67.0/${tooling ? "tooling/" : ""}query?q=${encodeURIComponent(soql)}`;
    return z
      .object({ records: z.array(schema).max(1000), done: z.boolean().optional() })
      .parse(await (read ? read(path) : directRequest(this.cli, org, path)));
  }
  async overview(org: Org) {
    const discovery = await this.cli.discover(true);
    const connection = discovery.connections.find(
      (c) =>
        c.orgId &&
        canonicalIdentity(c.orgId) === canonicalIdentity(org.salesforce_org_id) &&
        c.username === org.username,
    );
    const expirationDate =
      connection && "expirationDate" in connection ? (connection.expirationDate ?? null) : null;
    let result;
    try {
      result = await this.query(
        org,
        "SELECT Id,OrganizationType,InstanceName,NamespacePrefix,TrialExpirationDate FROM Organization LIMIT 1",
        z.object({
          Id: sfId,
          OrganizationType: nullable,
          InstanceName: nullable,
          NamespacePrefix: nullable,
          TrialExpirationDate: nullable,
        }),
      );
    } catch (error) {
      if (!connection || (error instanceof HttpError && error.code === "connection_changed"))
        throw error;
      return {
        ...checked(org),
        detailsAvailable: false,
        edition: null,
        instance: null,
        namespace: null,
        trialExpirationDate: null,
        environment: connection.environment,
        expirationDate,
      };
    }
    const info = result.records[0];
    if (!info || canonicalIdentity(info.Id) !== canonicalIdentity(org.salesforce_org_id))
      throw new HttpError(
        409,
        "connection_changed",
        "Salesforce returned a different org. Reconnect this connection.",
      );
    return {
      ...checked(org),
      detailsAvailable: true,
      edition: info.OrganizationType,
      instance: info.InstanceName,
      namespace: info.NamespacePrefix,
      trialExpirationDate: info.TrialExpirationDate,
      environment:
        connection?.environment ??
        (org.is_sandbox === null ? "unknown" : org.is_sandbox ? "sandbox" : "production"),
      expirationDate,
    };
  }
  async limits(org: Org) {
    await verifiedOrgSession(this.cli, org);
    const limits = z
      .array(
        z.object({
          name: z.string(),
          max: z.number().finite().nonnegative(),
          remaining: z.number().finite().nonnegative(),
        }),
      )
      .max(1000)
      .parse(await this.cli.utilityLimits(org.username));
    return {
      ...checked(org),
      limits: limits.map(({ name, max, remaining }) => ({ name, max, remaining })),
    };
  }
  async licenses(org: Org) {
    return withVerifiedRead(this.cli, org, async (read) => {
      // Optional permissions or unsupported resources can yield a partial inventory.
      // Transport failures, cancellation, expired auth and invalid data fail the operation.
      const allowUnavailable = (error: unknown) => {
        if (!(error instanceof HttpError) || error.code !== "provider_rejected") throw error;
      };
      let monthlyLoginsAvailable = false;
      try {
        const describe = z
          .object({ fields: z.array(z.object({ name: z.string() })).max(10000) })
          .parse(await read("/services/data/v67.0/sobjects/UserLicense/describe"));
        monthlyLoginsAvailable = ["MonthlyLoginsEntitlement", "MonthlyLoginsUsed"].every((field) =>
          describe.fields.some((f) => f.name === field),
        );
      } catch (error) {
        allowUnavailable(error);
        // Optional capability discovery must not hide the core seat inventory.
      }
      const quantity = z
        .number()
        .finite()
        .nullish()
        .transform((value) => (value !== undefined && value !== null && value >= 0 ? value : null));
      const row = z.object({
        Id: sfId,
        Name: nullable,
        MasterLabel: nullable,
        DeveloperName: nullable,
        NamespacePrefix: nullable,
        Status: nullable,
        TotalLicenses: quantity,
        AllowedLicenses: quantity,
        UsedLicenses: quantity,
        ExpirationDate: nullable,
        UsedLicensesLastUpdated: nullable,
        MonthlyLoginsEntitlement: quantity,
        MonthlyLoginsUsed: quantity,
      });
      const inventories = [
        {
          kind: "user" as const,
          query: `SELECT Id,Name,MasterLabel,Status,TotalLicenses,UsedLicenses,UsedLicensesLastUpdated${monthlyLoginsAvailable ? ",MonthlyLoginsEntitlement,MonthlyLoginsUsed" : ""} FROM UserLicense ORDER BY Name LIMIT 501`,
        },
        {
          kind: "permission-set" as const,
          query:
            "SELECT Id,MasterLabel,DeveloperName,Status,TotalLicenses,UsedLicenses,ExpirationDate FROM PermissionSetLicense ORDER BY MasterLabel LIMIT 501",
        },
        {
          kind: "package" as const,
          query:
            "SELECT Id,NamespacePrefix,Status,AllowedLicenses,UsedLicenses,ExpirationDate FROM PackageLicense ORDER BY NamespacePrefix LIMIT 501",
        },
      ];
      const groups = await Promise.all(
        inventories.map(async ({ kind, query }) => {
          try {
            const result = await this.query(org, query, row, false, read);
            return {
              kind,
              availability: "available" as const,
              capped: result.records.length > 500 || result.done === false,
              licenses: result.records.slice(0, 500).map((r) => ({
                id: r.Id,
                name: r.MasterLabel || r.Name || r.NamespacePrefix || "Unnamed license",
                apiName: r.DeveloperName || r.Name || r.NamespacePrefix || "",
                status: r.Status,
                total: kind === "package" ? r.AllowedLicenses : r.TotalLicenses,
                used: r.UsedLicenses,
                expiresAt: r.ExpirationDate,
                usageUpdatedAt: r.UsedLicensesLastUpdated,
                monthlyLogins:
                  kind === "user" && r.MonthlyLoginsEntitlement !== null
                    ? { total: r.MonthlyLoginsEntitlement, used: r.MonthlyLoginsUsed }
                    : null,
              })),
            };
          } catch (error) {
            allowUnavailable(error);
            return { kind, availability: "unavailable" as const, licenses: [], capped: false };
          }
        }),
      );
      return { ...checked(org), monthlyLoginsAvailable, groups };
    });
  }
  async metadata(org: Org) {
    await verifiedOrgSession(this.cli, org);
    const result = z
      .object({
        metadataObjects: z
          .array(
            z.object({
              xmlName: apiName,
              directoryName: z.string(),
              suffix: nullable,
              inFolder: z.boolean(),
              childXmlNames: z.array(apiName).max(100).default([]),
            }),
          )
          .max(1000),
      })
      .parse(await this.cli.metadataTypes(org.username));
    return {
      ...checked(org),
      apiVersion: HEADFUL_SALESFORCE_API_VERSION,
      types: result.metadataObjects
        .map((t) => ({
          name: t.xmlName,
          directory: t.directoryName,
          suffix: t.suffix,
          inFolder: t.inFolder,
          childTypes: t.childXmlNames,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  async components(org: Org, type: string, folder?: string) {
    const discovery = await this.metadata(org);
    const described = discovery.types.find((candidate) => candidate.name === type);
    const child = discovery.types.some((candidate) => candidate.childTypes.includes(type));
    if (!described && !child)
      throw new HttpError(
        400,
        "metadata_type_unavailable",
        "This metadata type is not advertised by the org at the selected API version.",
      );
    if (Boolean(described?.inFolder) !== Boolean(folder))
      throw new HttpError(
        400,
        "metadata_folder_scope",
        described?.inFolder
          ? "Choose an exact, case-sensitive folder for this metadata type."
          : "This metadata type does not accept a folder scope.",
      );
    const records = z
      .array(
        z.object({
          fullName: z.string().max(1000),
          namespacePrefix: nullable,
          lastModifiedDate: nullable,
          lastModifiedByName: nullable,
          manageableState: nullable,
        }),
      )
      .max(10000)
      .parse(await this.cli.metadataComponents(org.username, type, folder));
    return {
      ...checked(org),
      apiVersion: HEADFUL_SALESFORCE_API_VERSION,
      type,
      folder: folder ?? null,
      completeness: "not-guaranteed" as const,
      returnedCount: records.length,
      components: records.slice(0, 500).map((c) => ({
        name: c.fullName,
        namespace: c.namespacePrefix,
        modifiedAt: c.lastModifiedDate,
        modifiedBy: c.lastModifiedByName,
        manageableState: c.manageableState,
      })),
      capped: records.length > 500,
    };
  }
  async environments(org: Org) {
    await verifiedOrgSession(this.cli, org);
    if (org.is_sandbox)
      return { ...checked(org), availability: "production-only", sandboxes: [], capped: false };
    const inventory = await this.query(
      org,
      "SELECT Id,SandboxName,Description,LicenseType FROM SandboxInfo ORDER BY SandboxName LIMIT 100",
      z.object({ Id: sfId, SandboxName: z.string(), Description: nullable, LicenseType: nullable }),
      true,
    );
    const processes = await this.query(
      org,
      "SELECT SandboxInfoId,Status,CopyProgress,CreatedDate,EndDate FROM SandboxProcess ORDER BY CreatedDate DESC LIMIT 1000",
      z.object({
        SandboxInfoId: sfId,
        Status: nullable,
        CopyProgress: z.number().min(0).max(100).nullish(),
        CreatedDate: nullable,
        EndDate: nullable,
      }),
      true,
    );
    return {
      ...checked(org),
      availability: "available",
      capped:
        inventory.records.length === 100 ||
        processes.records.length === 1000 ||
        processes.done === false,
      sandboxes: inventory.records.map((s) => {
        const process = processes.records.find(
          (p) => canonicalIdentity(p.SandboxInfoId) === canonicalIdentity(s.Id),
        );
        return {
          id: s.Id,
          name: s.SandboxName,
          description: s.Description,
          license: s.LicenseType,
          status: process?.Status ?? null,
          progress: process?.CopyProgress ?? null,
          requestedAt: process?.CreatedDate ?? null,
          completedAt: process?.EndDate ?? null,
        };
      }),
    };
  }
}
