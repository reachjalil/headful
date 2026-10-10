import { headfulResultSchemas, type HeadfulOperation } from "@t3tools/contracts/headful";
import type { ExperienceFixture } from "@t3tools/contracts/headful-experiences";
import type { SetupDispatch } from "../setup-service";

/** Fictional lead data for the isolated lead-review preview. Never imported by production startup. */
export function createLeadFixture(fixture: ExperienceFixture): SetupDispatch {
  if (!import.meta.env.DEV) throw new Error("Lead fixtures are development-only.");
  const org = {
    id: "fixture_production",
    label: "Acme Production",
    salesforceOrgId: "00D000000000001",
    instanceOrigin: "https://fictional.my.salesforce.com",
    status: fixture === "expired" ? "reconnect-required" : "connected",
    createdAt: 1791219600,
    isSandbox: false,
    organizationName: "Acme",
  };
  const managed = {
    ...org,
    username: "alex@acme.example",
    principalId: "005000000000001",
    alias: "acme-prod",
    color: "#626dd2",
    agentEnabled: true,
    remoteEnabled: false,
    isDefault: true,
    connectionVersion: 1,
  };
  const leads =
    fixture === "empty"
      ? []
      : [
          [
            "00Q000000000001",
            "Rivka Okafor",
            "VP Operations",
            "Northwind Fictional",
            "Working",
            "Hot",
          ],
          ["00Q000000000002", "Tomás Lindqvist", "IT Director", "Contoso Example", "Open", "Warm"],
          [
            "00Q000000000003",
            "Mei Arslan",
            "Head of Sales",
            "Fabrikam Sample",
            "Nurturing",
            "Cold",
          ],
        ].map(([id, name, title, company, status, rating]) => ({
          id: id!,
          name: name!,
          title: title!,
          company: company!,
          status: status!,
          rating: rating as "Hot" | "Warm" | "Cold",
          email: `${id!.slice(-1)}.lead@example.com`,
          source: "Web",
          industry: "Technology",
          description: "Fictional lead for the development preview.",
        }));
  const retrievedAt = "2026-10-06T12:00:00.000Z";
  return (async (operation: HeadfulOperation, input: Record<string, unknown>) => {
    let value: unknown;
    if (operation === "orgs.list") value = { orgs: [managed], defaultOrgId: managed.id };
    else if (operation === "listLeads" || operation === "inspectLead") {
      if (fixture === "expired")
        throw new Error("Salesforce CLI login expired. Reconnect this org in Setup.");
      value =
        operation === "listLeads"
          ? {
              org,
              leads,
              retrievedAt,
              authority: "connected-salesforce-read",
              limit: 25,
              bounded: true,
              page: 1,
              hasMore: false,
            }
          : {
              org,
              lead: leads.find((lead) => lead.id === input.leadId),
              retrievedAt,
              authority: "connected-salesforce-read",
            };
    } else throw new Error(`Lead fixture does not implement ${operation}.`);
    return headfulResultSchemas[operation].parse(value);
  }) as SetupDispatch;
}
