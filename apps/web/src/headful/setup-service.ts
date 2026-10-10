import {
  headfulInputSchemas,
  headfulResultSchemas,
  type HeadfulInput,
  type HeadfulOperation,
  type HeadfulResult,
} from "@t3tools/contracts/headful";

export type SetupDispatch = <K extends HeadfulOperation>(
  operation: K,
  input: HeadfulInput<K>,
) => Promise<HeadfulResult<K>>;

/** Only typed, credential-safe operations cross the native boundary. */
export const setupDispatch: SetupDispatch = async (operation, input) => {
  if (!window.headfulBridge) throw new Error("Open Headful on your Mac to connect Salesforce.");
  const result = await window.headfulBridge.dispatch(
    operation,
    headfulInputSchemas[operation].parse(input),
  );
  return headfulResultSchemas[operation].parse(result) as HeadfulResult<typeof operation>;
};

export type SetupFixture = "ready" | "missing" | "unsupported" | "empty" | "expired";

export const salesforceCliInstallUrl =
  "https://developer.salesforce.com/docs/platform/sfdx-setup/guide/sfdx-setup-install-cli.html";
export const salesforceCliUpgradeUrl =
  "https://developer.salesforce.com/docs/platform/sfdx-setup/guide/sfdx-setup-update-cli.html";
