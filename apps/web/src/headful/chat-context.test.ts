import { describe, expect, it } from "vite-plus/test";
import {
  chatOrgInstructions,
  initializeChatPin,
  pinMatchesConnection,
  pinOrg,
  type ChatOrg,
} from "./chat-context";

function org(id: string, overrides: Partial<ChatOrg> = {}): ChatOrg {
  return {
    id,
    label: id,
    salesforceOrgId: "00D000000000001AAA",
    instanceOrigin: "https://example.my.salesforce.com",
    status: "connected",
    createdAt: 1791072000000,
    isSandbox: false,
    organizationName: "Fictional QA",
    username: "qa@example.invalid",
    principalId: "005000000000001AAA",
    alias: "qa",
    color: "#626dd2",
    agentEnabled: true,
    remoteEnabled: false,
    isDefault: false,
    connectionVersion: 1,
    ...overrides,
  };
}
describe("Headful conversation org context", () => {
  it("pins the initial default once and keeps it after the global default changes", () => {
    const original = initializeChatPin({}, "thread:one", [], org("production"));
    expect(initializeChatPin(original, "thread:one", [], org("sandbox"))).toBe(original);
    expect(original["thread:one"]?.orgId).toBe("production");
  });
  it("keeps explicitly cleared context when an org later becomes the default", () => {
    const pins = { "thread:one": null };
    expect(initializeChatPin(pins, "thread:one", [], org("production"))).toBe(pins);
  });
  it("carries a draft pin to the promoted thread without choosing the current default", () => {
    const pins = { "draft:one": pinOrg(org("sandbox")) };
    const promoted = initializeChatPin(pins, "thread:env/one", ["draft:one"], org("production"));
    expect(promoted["thread:env/one"]).toEqual(pins["draft:one"]);
  });
  it("does not overwrite an existing canonical conversation during alias reconciliation", () => {
    const pins = {
      "thread:env/one": pinOrg(org("production")),
      "draft:one": pinOrg(org("sandbox")),
    };
    expect(initializeChatPin(pins, "thread:env/one", ["draft:one"], org("another"))).toBe(pins);
  });
  it("rejects a changed principal, org identity or connection generation", () => {
    const original = org("production");
    const pin = pinOrg(original);
    expect(pinMatchesConnection(pin, original)).toBe(true);
    expect(pinMatchesConnection(pin, { ...original, principalId: "005000000000002AAA" })).toBe(
      false,
    );
    expect(pinMatchesConnection(pin, { ...original, salesforceOrgId: "00D000000000002AAA" })).toBe(
      false,
    );
    expect(pinMatchesConnection(pin, { ...original, connectionVersion: 2 })).toBe(false);
  });
  it("copies explicit org identity and keeps grant and human review requirements clear", () => {
    const instructions = chatOrgInstructions(pinOrg(org("production")));
    expect(instructions).toContain("Headful org ID: production");
    expect(instructions).toContain("This context does not grant access");
    expect(instructions).toContain("Never approve or execute writes from chat");
    expect(instructions).not.toContain("qa@example.invalid");
  });
});
