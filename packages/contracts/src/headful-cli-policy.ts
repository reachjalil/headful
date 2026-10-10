/** Release policy: raise this version when a desktop release needs newer CLI commands. */
export const HEADFUL_MINIMUM_SALESFORCE_CLI_VERSION = "2.136.0";

export function supportsSalesforceCli(
  version: string,
  minimum = HEADFUL_MINIMUM_SALESFORCE_CLI_VERSION,
): boolean {
  const found = /^(?:@salesforce\/cli\/|sf\/)?(\d+)\.(\d+)\.(\d+)(?=\s|$)/.exec(version.trim());
  const required = /^(\d+)\.(\d+)\.(\d+)$/.exec(minimum);
  if (!found || !required) return false;
  for (let index = 1; index <= 3; index++) {
    const actual = Number(found[index]),
      floor = Number(required[index]);
    if (actual !== floor) return actual > floor;
  }
  return true;
}
