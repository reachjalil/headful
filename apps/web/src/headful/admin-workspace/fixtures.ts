import {
  headfulInputSchemas,
  headfulResultSchemas,
  type HeadfulOperation,
  type HeadfulResult,
} from "@t3tools/contracts/headful";
import { createOrgSettingsFixture } from "../org-settings/fixtures";
import type { SetupDispatch, SetupFixture } from "../setup-service";
import exampleRegistration from "../../../../../examples/hello-mod/headful.mod.json";
import { headfulModDescriptorSchema } from "@t3tools/contracts/headful-mods";

/** Synthetic, development-only service responses. No native bridge or provider requests. */
export function createAdminFixture(fixture: SetupFixture, referenceMod = false): SetupDispatch {
  if (!import.meta.env.DEV) throw new Error("Admin fixtures are development-only.");
  const base = createOrgSettingsFixture(fixture);
  let saved: HeadfulResult<"utilities.saved.list">["queries"] = [];
  let history: HeadfulResult<"utilities.history.list">["history"] = [];
  let favorites: HeadfulResult<"utilities.favorites.list">["favorites"] = [];
  let serial = 0;
  let count = 0;
  const example = headfulModDescriptorSchema.parse({
    manifest: exampleRegistration,
    enabled: true,
    compatible: true,
    status: "inactive",
    artifactRevision: "fixture-counter",
    grantedPermissions: exampleRegistration.permissions,
  });
  return (async (operation: HeadfulOperation, raw: Record<string, unknown>) => {
    if (referenceMod && operation === "mods.list") {
      const current = await base("mods.list", {});
      return { ...current, mods: [...current.mods, example] };
    }
    if (
      referenceMod &&
      (operation === "mods.command" || operation === "mods.surface") &&
      raw.id === example.manifest.id
    ) {
      const input = headfulInputSchemas[operation].parse(raw);
      if (input.artifactRevision !== example.artifactRevision)
        throw new Error("Fixture mod revision changed.");
      if (
        operation === "mods.command" &&
        "command" in input &&
        input.command === "org.example.hello/hello"
      ) {
        count++;
        return headfulResultSchemas[operation].parse({
          message: "Development fixture: hello from the local counter.",
          values: { count },
        });
      }
      if (operation === "mods.surface" && "surfaceId" in input && input.surfaceId === "overview")
        return headfulResultSchemas[operation].parse({
          title: "Local counter",
          markdown: `Invocations: ${count}.\n\nThis development fixture uses the real example manifest with synthetic local output.\n\n## Admin handoff\n\n| Item | State |\n| --- | --- |\n| Org context | Pinned by Headful |\n| Query | Ready for explicit review |\n\n\`\`\`sql\nSELECT Id, Name FROM Account LIMIT 50\n\`\`\`\n\n### Formula notation\n\nAn example conversion rate is $r = \\frac{w}{n}$.\n\n$$\nr = \\frac{24}{80} \\times 100\\% = 30\\%\n$$\n\n> Formula notation is rendered locally. This document does not execute a query or evaluate Salesforce formulas.`,
        });
      throw new Error("Fixture mod contribution unavailable.");
    }
    if (!operation.startsWith("utilities.")) return base(operation, raw as never);
    const input = headfulInputSchemas[operation].parse(raw) as Record<string, unknown>;
    if (fixture === "expired" || fixture === "unsupported" || fixture === "missing")
      throw new Error(
        "This fixture’s connection is unavailable. Reconnect it in Connections & CLI.",
      );
    const { orgs } = await base("orgs.list", {});
    const selected = orgs.find((org) => org.id === input.orgId);
    if (!selected) throw new Error("Choose a connected org.");
    const {
      id,
      label,
      salesforceOrgId,
      instanceOrigin,
      status,
      createdAt,
      isSandbox,
      organizationName,
    } = selected;
    const org = {
      id,
      label,
      salesforceOrgId,
      instanceOrigin,
      status,
      createdAt,
      isSandbox,
      organizationName,
    };
    let value: unknown;
    switch (operation) {
      case "utilities.objects.list":
        value = {
          org,
          bounded: true,
          objects: ["Account", "Contact", "Lead", "Opportunity", "Project__c", "User"].map(
            (name) => ({ name, custom: name.endsWith("__c") }),
          ),
        };
        break;
      case "utilities.objects.describe": {
        const name = String(input.object);
        value = {
          org,
          bounded: true,
          name,
          label: name.replace("__c", ""),
          labelPlural: `${name}s`,
          keyPrefix: "001",
          queryable: true,
          searchable: true,
          custom: name.endsWith("__c"),
          childRelationships: [],
          fields: [
            ["Id", "Record ID", "id"],
            ["Name", "Name", "string"],
            ["Industry", "Industry", "picklist"],
            ["OwnerId", "Owner", "reference"],
            ["CreatedDate", "Created date", "datetime"],
            ["LastModifiedDate", "Last modified", "datetime"],
            ["Annual_Revenue_Band__c", "Revenue band", "string"],
          ].map(([field, label, type]) => ({
            name: field,
            label,
            type,
            length: type === "string" ? 255 : null,
            nillable: field !== "Id",
            createable: field !== "Id" && field !== "Annual_Revenue_Band__c",
            updateable: field !== "Id" && field !== "Annual_Revenue_Band__c",
            calculated: field === "Annual_Revenue_Band__c",
            calculatedFormula:
              field === "Annual_Revenue_Band__c"
                ? 'IF(AnnualRevenue >= 1000000, "Enterprise", "Growth")'
                : null,
            referenceTo: type === "reference" ? ["User"] : [],
            relationshipName: type === "reference" ? "Owner" : null,
            picklistValues: [],
          })),
        };
        break;
      }
      case "utilities.query.run": {
        if (!/^\s*SELECT\b/i.test(String(input.query)))
          throw new Error("Enter one read-only SELECT query.");
        const columns = String(input.query)
          .match(/^\s*SELECT\s+(.+?)\s+FROM\b/i)?.[1]
          ?.split(",")
          .map((name) => name.trim()) ?? ["Id"];
        const records = ["Acme Example", "Northstar Example", "Cedar Example"].map((name, i) =>
          Object.fromEntries(
            columns.map((column) => [
              column,
              column === "Id" ? `00100000000000${i + 1}AAA` : column === "Name" ? name : null,
            ]),
          ),
        );
        value = {
          org,
          bounded: true,
          requestId: input.requestId,
          query: input.query,
          page: input.page,
          pageSize: input.pageSize,
          columns: columns.map((name) => ({ name, label: name, type: "string" })),
          records,
          returned: records.length,
          hasMore: false,
          elapsedMs: 18,
        };
        history.unshift({
          id: `history_fixture_${++serial}`,
          orgId: org.id,
          query: String(input.query),
          createdAt: 1791450000,
          returned: records.length,
          status: "success",
          elapsedMs: 18,
        });
        break;
      }
      case "utilities.query.cancel":
        value = { requestId: input.requestId, cancelled: false };
        break;
      case "utilities.record.get":
        value = {
          org,
          bounded: true,
          object: input.object,
          recordId: input.recordId,
          fields: [
            { name: "Id", label: "Record ID", type: "id", value: input.recordId },
            { name: "Name", label: "Name", type: "string", value: "Acme Example" },
            { name: "Industry", label: "Industry", type: "picklist", value: "Technology" },
          ],
        };
        break;
      case "utilities.saved.list":
        value = { queries: saved.filter((item) => item.orgId === org.id) };
        break;
      case "utilities.saved.set": {
        const item = {
          id: `saved_query_fixture_${++serial}`,
          orgId: org.id,
          name: String(input.name),
          query: String(input.query),
          updatedAt: 1791450000,
        };
        saved = [item, ...saved];
        value = item;
        break;
      }
      case "utilities.saved.remove":
        saved = saved.filter((item) => item.orgId !== org.id || item.id !== input.id);
        value = { removed: true };
        break;
      case "utilities.history.list":
        value = { history: history.filter((item) => item.orgId === org.id) };
        break;
      case "utilities.favorites.list":
        value = { favorites: favorites.filter((item) => item.orgId === org.id) };
        break;
      case "utilities.favorites.set": {
        const item = {
          id: `favorite_fixture_${++serial}`,
          orgId: org.id,
          label: String(input.label),
          destination: input.destination as "setup",
          ...(input.recordId ? { recordId: String(input.recordId) } : {}),
        };
        favorites = [item, ...favorites];
        value = item;
        break;
      }
      case "utilities.favorites.remove":
        favorites = favorites.filter((item) => item.orgId !== org.id || item.id !== input.id);
        value = { removed: true };
        break;
      case "utilities.backup.location":
        return {
          url: "https://headful.cloud/backup?sourceOrg=00D000000000001",
          executor: "cloud",
          cloudAuthorization: "required",
        };
      case "utilities.org.open":
        value = { opened: true };
        break;
      case "utilities.diagnostics":
        value = {
          org,
          bounded: true,
          limits: [{ name: "DailyApiRequests", max: 100000, remaining: 74280 }],
          storage: [{ name: "Data storage", max: 1024, remaining: 256, unit: "MB" }],
          jobs: [
            {
              id: "707000000000001",
              type: "Queueable",
              status: "Completed",
              createdAt: "2026-10-08T09:00:00Z",
              completedAt: "2026-10-08T09:01:00Z",
              processed: 3,
              total: 3,
              errors: 0,
            },
          ],
          messages: [],
        };
        break;
      case "utilities.logs.list":
        value = { org, bounded: true, logs: [] };
        break;
      default:
        throw new Error("This operation is not included in the fixture.");
    }
    return headfulResultSchemas[operation].parse(value);
  }) as SetupDispatch;
}
