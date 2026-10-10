export const limitCategories = [
  "All limits",
  "API & integrations",
  "Storage",
  "Automation",
  "Development",
  "Other",
] as const;
export type LimitCategory = (typeof limitCategories)[number];
const definitions: Record<
  string,
  { category: LimitCategory; unit: string; window: string; description: string }
> = {
  DailyApiRequests: {
    category: "API & integrations",
    unit: "requests",
    window: "Rolling 24 hours",
    description: "Shared API capacity used by integrations and CLI reads.",
  },
  DataStorageMB: {
    category: "Storage",
    unit: "MB",
    window: "Current allocation",
    description: "Storage for records. Check this before importing or generating data.",
  },
  FileStorageMB: {
    category: "Storage",
    unit: "MB",
    window: "Current allocation",
    description: "Storage for files and attachments.",
  },
  DailyAsyncApexExecutions: {
    category: "Automation",
    unit: "executions",
    window: "24-hour period",
    description: "Batch, scheduled, future and queueable Apex capacity.",
  },
  DailyBulkApiBatches: {
    category: "API & integrations",
    unit: "batches",
    window: "24-hour period",
    description: "Bulk API batch capacity. Bulk API versions have different limits.",
  },
  ActiveScratchOrgs: {
    category: "Development",
    unit: "orgs",
    window: "Concurrent allocation",
    description: "Scratch orgs that can be active at the same time in this Dev Hub.",
  },
  DailyScratchOrgs: {
    category: "Development",
    unit: "orgs",
    window: "Daily allowance",
    description: "Scratch orgs this Dev Hub can create in a day.",
  },
};
export function limitInfo(name: string) {
  return (
    definitions[name] ?? {
      category: "Other" as const,
      unit: "reported units",
      window: "Window not specified",
      description:
        "Salesforce reports this capacity without a unit or reset window in the CLI response. Check its limit documentation before planning work.",
    }
  );
}
