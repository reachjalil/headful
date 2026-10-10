import { describe, expect, it } from "vite-plus/test";
import {
  supportsSalesforceCli,
  HEADFUL_MINIMUM_SALESFORCE_CLI_VERSION,
} from "./headful-cli-policy.ts";

describe("desktop release Salesforce CLI minimum", () => {
  it.each(["2.136.0", "@salesforce/cli/2.136.0 darwin-arm64 node-v24", "sf/2.137.0", "3.0.0"])(
    "supports %s",
    (version) => {
      expect(supportsSalesforceCli(version)).toBe(true);
    },
  );
  it.each([
    "2.135.99",
    "2.99.99",
    "1.999.0",
    "sfdx-cli/7.209.6",
    "@salesforce/cli/2.136.0-beta",
    "invalid",
    "2.108",
  ])("rejects %s", (version) => {
    expect(supportsSalesforceCli(version)).toBe(false);
  });
  it("lets the next release raise the floor and fails closed for invalid policy", () => {
    expect(HEADFUL_MINIMUM_SALESFORCE_CLI_VERSION).toBe("2.136.0");
    expect(supportsSalesforceCli("2.136.0", "2.137.0")).toBe(false);
    expect(supportsSalesforceCli("2.137.0", "2.137.0")).toBe(true);
    expect(supportsSalesforceCli("9.0.0", "invalid")).toBe(false);
  });
});
