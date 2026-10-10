import { headfulResultSchemas, type HeadfulResult } from "@t3tools/contracts/headful";
import { createSetupFixture } from "../setup-fixtures";
import type { SetupDispatch, SetupFixture } from "../setup-service";

/** Fictional design data, schema-checked and unreachable in production. */
export function createOrgSettingsFixture(fixture: SetupFixture): SetupDispatch {
  if (!import.meta.env.DEV) throw new Error("Org settings fixtures are development-only.");
  const setup = createSetupFixture(fixture);
  return (async (operation, input) => {
    if (
      ![
        "orgs.overview",
        "orgs.limits",
        "orgs.licenses",
        "orgs.metadata",
        "orgs.metadata.components",
        "orgs.environments",
      ].includes(operation)
    )
      return setup(operation, input);
    if (fixture === "missing" || fixture === "unsupported")
      throw new Error("Fixture information unavailable.");
    const { orgs } = await setup("orgs.list", {});
    const id = "orgId" in input ? input.orgId : "";
    const org = orgs.find((o) => o.id === id);
    if (!org) throw new Error("Fixture connection unavailable.");
    const base = {
      org: {
        id: org.id,
        label: org.label,
        salesforceOrgId: org.salesforceOrgId,
        instanceOrigin: org.instanceOrigin,
        status: org.status,
        createdAt: org.createdAt,
        isSandbox: org.isSandbox,
        organizationName: org.organizationName,
      },
      checkedAt: new Date().toISOString(),
      bounded: true,
    };
    const scratch = org.id === "fixture_scratch_org";
    const soon = new Date(Date.now() + (fixture === "expired" ? -1 : 3) * 86400000)
      .toISOString()
      .slice(0, 10);
    let value: unknown;
    switch (operation) {
      case "orgs.overview":
        value = {
          ...base,
          detailsAvailable: fixture !== "expired",
          edition:
            fixture === "expired" ? null : scratch ? "Developer Edition" : "Enterprise Edition",
          instance: "NA999",
          namespace: null,
          environment: scratch ? "scratch" : org.isSandbox ? "sandbox" : "production",
          expirationDate: scratch ? soon : null,
          trialExpirationDate: null,
        };
        break;
      case "orgs.limits":
        value = {
          ...base,
          limits: [
            { name: "DailyApiRequests", max: 100000, remaining: 74280 },
            { name: "DataStorageMB", max: 10240, remaining: 1230 },
            { name: "FileStorageMB", max: 20480, remaining: 16920 },
            { name: "DailyAsyncApexExecutions", max: 250000, remaining: 241200 },
            { name: "DailyBulkApiBatches", max: 15000, remaining: 14580 },
            { name: "ActiveScratchOrgs", max: 10, remaining: 6 },
            { name: "DailyScratchOrgs", max: 20, remaining: 16 },
          ],
        };
        break;
      case "orgs.licenses": {
        const row = (
          id: string,
          name: string,
          total: number | null,
          used: number | null,
          extra = {},
        ) => ({
          id,
          name,
          apiName: name,
          total,
          used,
          status: "Active",
          expiresAt: null,
          usageUpdatedAt: null,
          monthlyLogins: null,
          ...extra,
        });
        value = {
          ...base,
          monthlyLoginsAvailable: true,
          groups: [
            {
              kind: "user",
              availability: "available",
              capped: false,
              licenses: scratch
                ? [row("fixture-user-scratch", "Salesforce", 2, 1)]
                : [
                    row("fixture-user-salesforce", "Salesforce", 50, 46, {
                      usageUpdatedAt: base.checkedAt,
                    }),
                    row("fixture-user-platform", "Salesforce Platform", 30, 18),
                    row("fixture-user-integration", "Salesforce Integration", 5, 3),
                    row("fixture-user-community", "Customer Community Login", 5000, 1500, {
                      monthlyLogins: { total: 1000, used: 980 },
                    }),
                  ],
            },
            {
              kind: "permission-set",
              availability: "available",
              capped: false,
              licenses: [
                row("fixture-feature-service", "Service Cloud User", 20, 20, {
                  apiName: "ServiceCloudUser",
                }),
                row("fixture-feature-einstein", "CRM Analytics Plus", 10, 6, {
                  apiName: "CRMAnalyticsPlus",
                  status: "Trial",
                  expiresAt: soon,
                }),
                row("fixture-feature-retired", "Retired feature trial", 0, 0, {
                  status: "Disabled",
                  expiresAt: "2026-09-01",
                }),
              ],
            },
            {
              kind: "package",
              availability: "available",
              capped: false,
              licenses: [
                row("fixture-package-documents", "document_tools", 25, 19),
                row("fixture-package-utilities", "org_utilities", null, 0, { status: "Free" }),
              ],
            },
          ],
        };
        break;
      }
      case "orgs.metadata":
        value = {
          ...base,
          apiVersion: "67.0",
          types: [
            {
              name: "ApexClass",
              directory: "classes",
              suffix: "cls",
              inFolder: false,
              childTypes: [],
            },
            {
              name: "CustomObject",
              directory: "objects",
              suffix: "object",
              inFolder: false,
              childTypes: ["CustomField", "RecordType", "ValidationRule"],
            },
            { name: "Flow", directory: "flows", suffix: "flow", inFolder: false, childTypes: [] },
            {
              name: "Layout",
              directory: "layouts",
              suffix: "layout",
              inFolder: false,
              childTypes: [],
            },
            {
              name: "PermissionSet",
              directory: "permissionsets",
              suffix: "permissionset",
              inFolder: false,
              childTypes: [],
            },
            {
              name: "Report",
              directory: "reports",
              suffix: "report",
              inFolder: true,
              childTypes: [],
            },
          ],
        };
        break;
      case "orgs.metadata.components": {
        const type = "type" in input ? input.type : "CustomObject";
        value = {
          ...base,
          apiVersion: "67.0",
          type,
          folder: "folder" in input ? (input.folder ?? null) : null,
          completeness: "not-guaranteed",
          returnedCount:
            type === "CustomObject" ? 5 : type === "ApexClass" || type === "Flow" ? 2 : 1,
          capped: false,
          components: (type === "CustomObject"
            ? ["Account", "Contact", "Lead", "Opportunity", "Project__c"]
            : type === "ApexClass"
              ? ["AccountHealthService", "OpportunitySyncJob"]
              : type === "Flow"
                ? ["New_Lead_Assignment", "Opportunity_Stage_Update"]
                : [`${type}_Example`]
          ).map((name) => ({
            name,
            namespace: null,
            modifiedAt: "2026-10-06T16:30:00.000Z",
            modifiedBy: "Alex Morgan",
            manageableState: "unmanaged",
          })),
        };
        break;
      }
      case "orgs.environments":
        value = {
          ...base,
          availability: org.isSandbox ? "production-only" : "available",
          capped: false,
          sandboxes: org.isSandbox
            ? []
            : [
                {
                  id: "0GQ000000000001",
                  name: "dev",
                  description: "Daily development and quick experiments.",
                  license: "Developer",
                  status: "Completed",
                  progress: 100,
                  requestedAt: "2026-10-04T08:00:00Z",
                  completedAt: "2026-10-04T08:32:00Z",
                },
                {
                  id: "0GQ000000000002",
                  name: "uat",
                  description: "User acceptance testing for the next release.",
                  license: "Partial",
                  status: "Processing",
                  progress: 62,
                  requestedAt: "2026-10-07T07:00:00Z",
                  completedAt: null,
                },
              ],
        };
        break;
    }
    return headfulResultSchemas[operation].parse(value) as HeadfulResult<typeof operation>;
  }) as SetupDispatch;
}
