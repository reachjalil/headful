import {
  headfulResultSchemas,
  HEADFUL_MINIMUM_SALESFORCE_CLI_VERSION,
  type HeadfulOperation,
  type HeadfulResult,
} from "@t3tools/contracts/headful";
import type { SetupDispatch, SetupFixture } from "./setup-service";
import { adminManifest } from "./admin-workspace/editor-contributions";

/** Fictional design data. Never imported by production startup. */
export function createSetupFixture(fixture: SetupFixture): SetupDispatch {
  if (!import.meta.env.DEV) throw new Error("Setup fixtures are development-only.");
  const origin = "https://fictional.my.salesforce.com";
  const orgs: HeadfulResult<"orgs.list">["orgs"] =
    fixture === "empty"
      ? []
      : [
          {
            id: "fixture_production",
            label: "Acme Production",
            username: "alex@acme.example",
            salesforceOrgId: "00D000000000001",
            principalId: "005000000000001",
            alias: "acme-prod",
            color: "#626dd2",
            agentEnabled: true,
            remoteEnabled: false,
            isDefault: true,
            connectionVersion: 1,
            instanceOrigin: origin,
            status: "connected",
            createdAt: 1791219600,
            isSandbox: false,
            organizationName: "Acme",
          },
          {
            id: "fixture_development",
            label: "Acme Development",
            username: "alex@acme.example.dev",
            salesforceOrgId: "00D000000000002",
            principalId: "005000000000002",
            alias: "acme-dev",
            color: "#626dd2",
            agentEnabled: false,
            remoteEnabled: false,
            isDefault: false,
            connectionVersion: 1,
            instanceOrigin: "https://fictional--dev.sandbox.my.salesforce.com",
            status: fixture === "expired" ? "reconnect-required" : "connected",
            createdAt: 1791219600,
            isSandbox: true,
            organizationName: "Acme Development",
          },
          {
            id: "fixture_scratch_org",
            label: "Release Scratch",
            username: "test@acme.example.scratch",
            salesforceOrgId: "00D000000000003",
            principalId: "005000000000003",
            alias: "release-scratch",
            color: "#626dd2",
            agentEnabled: false,
            remoteEnabled: false,
            isDefault: false,
            connectionVersion: 1,
            instanceOrigin: "https://fictional-scratch.my.salesforce.com",
            status: "connected",
            createdAt: 1791219600,
            isSandbox: true,
            organizationName: "Release Scratch",
          },
        ];
  let completed = false;
  const currentFixture = fixture;
  const saved = () => ({ orgs: structuredClone(orgs), defaultOrgId: orgs[0]?.id ?? null });
  const features = () => ({
    features: [
      {
        id: "org-management",
        name: "Org management",
        description: "Fictional org authority.",
        availability: "available",
        defaultEnabled: true,
        dependencies: [],
        configuration: [],
        permissions: [],
        route: "orgs",
        lifecycle: "on-demand",
        enabled: true,
        configuredEnabled: true,
      },
      ...adminManifest.contributions.features.map((feature) => ({
        ...feature,
        enabled: true,
        configuredEnabled: true,
      })),
    ],
    mode: "minimal",
    onboardingComplete: completed,
  });
  return (async (operation: HeadfulOperation, input: Record<string, unknown>) => {
    let value: unknown;
    if (operation === "features.list") value = features();
    else if (operation === "mods.list")
      value = {
        apiVersion: 1,
        mods: [
          {
            manifest: adminManifest,
            enabled: true,
            compatible: true,
            status: "active",
            artifactRevision: "fixture-admin",
            grantedPermissions: adminManifest.permissions,
          },
        ],
      };
    else if (operation === "mods.inspect") {
      if (input.id !== adminManifest.id) throw new Error("Fixture mod missing.");
      value = {
        manifest: adminManifest,
        enabled: true,
        compatible: true,
        status: "active",
        artifactRevision: "fixture-admin",
        grantedPermissions: adminManifest.permissions,
      };
    } else if (operation === "mods.command") {
      if (input.id !== adminManifest.id || input.command !== "headful.admin-utilities/open-setup")
        throw new Error("Fixture command unavailable.");
      value = {
        message: "Development fixture: Salesforce Setup was not opened.",
        values: { "org-id": (input.input as Record<string, string>)["org-id"]! },
      };
    } else if (operation === "onboarding.complete") {
      completed = true;
      value = features();
    } else if (operation === "cli.detect" || operation === "cli.configure")
      value = {
        minimumVersion: HEADFUL_MINIMUM_SALESFORCE_CLI_VERSION,
        state:
          currentFixture === "missing"
            ? "missing"
            : currentFixture === "unsupported"
              ? "unsupported"
              : "ready",
        selected: ["missing", "unsupported"].includes(currentFixture)
          ? null
          : "/opt/homebrew/bin/sf",
        installations:
          currentFixture === "missing"
            ? []
            : [
                {
                  path: "/opt/homebrew/bin/sf",
                  version:
                    currentFixture === "unsupported"
                      ? "@salesforce/cli/2.50.0 darwin-arm64"
                      : `@salesforce/cli/${HEADFUL_MINIMUM_SALESFORCE_CLI_VERSION} darwin-arm64`,
                  supported: currentFixture !== "unsupported",
                  source: "common",
                },
              ],
        installerUrl: "https://developer.salesforce.com/tools/salesforcecli",
        architecture: "Apple Silicon",
        legacyDetected: false,
      };
    else if (operation === "orgs.list") value = saved();
    else if (operation === "orgs.discover")
      value = {
        connections: orgs.map((org) => ({
          orgId: org.salesforceOrgId,
          username: org.username,
          alias: org.alias,
          instanceUrl: org.instanceOrigin,
          isSandbox: org.isSandbox,
          environment:
            org.id === "fixture_scratch_org" ? "scratch" : org.isSandbox ? "sandbox" : "production",
          connectedStatus: org.status === "connected" ? "Connected" : "Refresh token expired",
          ...(org.id === "fixture_scratch_org" ? { expirationDate: "2099-10-12" } : {}),
        })),
        bounded: true,
      };
    else if (operation === "orgs.update") {
      const org = orgs.find((org) => org.id === input.orgId);
      if (!org) throw new Error("Fixture org missing.");
      org.agentEnabled = Boolean(input.agentEnabled);
      value = saved();
    } else if (operation === "orgs.health") {
      value = orgs.find((org) => org.id === input.orgId);
    } else if (operation === "orgs.open") value = { opened: true };
    else if (operation === "orgs.sandboxes")
      value = {
        org: (({
          id,
          label,
          salesforceOrgId,
          instanceOrigin,
          status,
          createdAt,
          isSandbox,
          organizationName,
        }) => ({
          id,
          label,
          salesforceOrgId,
          instanceOrigin,
          status,
          createdAt,
          isSandbox,
          organizationName,
        }))(orgs[0]!),
        sandboxes: [
          {
            Id: "0GQ000000000001",
            SandboxName: "uat",
            Description: "Fictional acceptance environment",
            LicenseType: "Developer",
            connected: false,
            loginOrigin: "https://test.salesforce.com",
          },
        ],
        availability: "available",
        bounded: true,
      };
    else if (operation === "orgs.login") {
      const source = input.environment === "production" ? orgs[0] : orgs[1];
      const connected = source ?? {
        id: "fixture_new_org_0001",
        label: "Acme New Org",
        username: "alex@acme.example.new",
        salesforceOrgId: "00D000000000004",
        principalId: "005000000000004",
        alias: "acme-new",
        color: "#626dd2",
        agentEnabled: false,
        remoteEnabled: false,
        isDefault: false,
        connectionVersion: 1,
        instanceOrigin: origin,
        status: "connected",
        createdAt: 1791219600,
        isSandbox: input.environment === "sandbox",
        organizationName: "Acme New Org",
      };
      connected.status = "connected";
      connected.connectionVersion++;
      if (!source) orgs.push(connected as (typeof orgs)[number]);
      value = connected;
    } else if (operation === "orgs.import")
      value = orgs.find((org) => org.username === input.username);
    else throw new Error(`Operation outside this design fixture: ${operation}`);
    return headfulResultSchemas[operation].parse(structuredClone(value));
  }) as SetupDispatch;
}
