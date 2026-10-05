import { z } from "zod";
import { headfulResultSchemas } from "@t3tools/contracts/headful";

export type ChatOrg = z.infer<typeof headfulResultSchemas.status>["orgs"][number];

export const pinnedOrgSchema = z.strictObject({
  orgId: z.string().min(1),
  salesforceOrgId: z.string().min(1),
  principalId: z.string().min(1),
  connectionVersion: z.number().int().positive(),
  label: z.string(),
  alias: z.string(),
  isSandbox: z.boolean().nullable(),
});
export type PinnedOrg = z.infer<typeof pinnedOrgSchema>;
export const chatPinsSchema = z.record(z.string(), pinnedOrgSchema.nullable());
export type ChatPins = z.infer<typeof chatPinsSchema>;

export function pinOrg(org: ChatOrg): PinnedOrg {
  return {
    orgId: org.id,
    salesforceOrgId: org.salesforceOrgId,
    principalId: org.principalId,
    connectionVersion: org.connectionVersion,
    label: org.label,
    alias: org.alias,
    isSandbox: org.isSandbox,
  };
}

/** Draft and server routes share a pin during promotion, without adopting a new global default. */
export function initializeChatPin(
  pins: ChatPins,
  key: string,
  aliases: readonly string[],
  defaultOrg: ChatOrg | null,
): ChatPins {
  const existingKey = [key, ...aliases].find((candidate) => Object.hasOwn(pins, candidate));
  const pin =
    existingKey === undefined
      ? defaultOrg
        ? pinOrg(defaultOrg)
        : null
      : (pins[existingKey] ?? null);
  if ([key, ...aliases].every((candidate) => Object.hasOwn(pins, candidate))) return pins;
  const next = { ...pins };
  for (const candidate of [key, ...aliases]) {
    if (!Object.hasOwn(next, candidate)) next[candidate] = pin;
  }
  return next;
}

export function pinMatchesConnection(pin: PinnedOrg, org: ChatOrg): boolean {
  return (
    pin.orgId === org.id &&
    pin.salesforceOrgId === org.salesforceOrgId &&
    pin.principalId === org.principalId &&
    pin.connectionVersion === org.connectionVersion
  );
}

export function chatOrgInstructions(pin: PinnedOrg): string {
  return [
    "Headful Salesforce context for this conversation:",
    `Org: ${pin.label}${pin.alias ? ` (${pin.alias})` : ""}`,
    `Environment: ${pin.isSandbox === true ? "Sandbox" : pin.isSandbox === false ? "Production" : "Unverified"}`,
    `Headful org ID: ${pin.orgId}`,
    `Salesforce org ID: ${pin.salesforceOrgId}`,
    `Salesforce principal ID: ${pin.principalId}`,
    `Connection version: ${pin.connectionVersion}`,
    "Use the configured Headful MCP with this explicit org ID. This context does not grant access.",
    "Prepare Salesforce changes for human review in the Headful workspace. Never approve or execute writes from chat.",
  ].join("\n");
}
