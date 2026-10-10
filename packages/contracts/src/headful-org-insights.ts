import { z } from "zod";
import { identifier, orgSchema } from "./headful-workspace/contract-schema.ts";

export const HEADFUL_SALESFORCE_API_VERSION = "67.0" as const;
const apiName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/);
const org = z.strictObject({ orgId: identifier });
const checked = { org: orgSchema, checkedAt: z.iso.datetime(), bounded: z.literal(true) };
export const orgInsightInputSchemas = {
  "orgs.overview": org,
  "orgs.limits": org,
  "orgs.licenses": org,
  "orgs.metadata": org,
  "orgs.metadata.components": z.strictObject({
    orgId: identifier,
    type: apiName,
    folder: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9_$][A-Za-z0-9_$ /-]{0,199}$/)
      .optional(),
  }),
  "orgs.environments": org,
} as const;
export const orgInsightResultSchemas = {
  "orgs.overview": z.strictObject({
    ...checked,
    detailsAvailable: z.boolean(),
    edition: z.string().nullable(),
    instance: z.string().nullable(),
    namespace: z.string().nullable(),
    environment: z.enum(["production", "sandbox", "scratch", "developer", "unknown"]),
    expirationDate: z.string().nullable(),
    trialExpirationDate: z.string().nullable(),
  }),
  "orgs.limits": z.strictObject({
    ...checked,
    limits: z
      .array(
        z.strictObject({
          name: z.string(),
          max: z.number().finite().nonnegative(),
          remaining: z.number().finite().nonnegative(),
        }),
      )
      .max(1000),
  }),
  "orgs.licenses": z.strictObject({
    ...checked,
    monthlyLoginsAvailable: z.boolean(),
    groups: z
      .array(
        z.strictObject({
          kind: z.enum(["user", "permission-set", "package"]),
          availability: z.enum(["available", "unavailable"]),
          capped: z.boolean(),
          licenses: z
            .array(
              z.strictObject({
                id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
                name: z.string().max(1000),
                apiName: z.string().max(1000),
                status: z.string().nullable(),
                total: z.number().finite().nonnegative().nullable(),
                used: z.number().finite().nonnegative().nullable(),
                expiresAt: z.string().nullable(),
                usageUpdatedAt: z.string().nullable(),
                monthlyLogins: z
                  .strictObject({
                    total: z.number().finite().nonnegative().nullable(),
                    used: z.number().finite().nonnegative().nullable(),
                  })
                  .nullable(),
              }),
            )
            .max(500),
        }),
      )
      .length(3),
  }),
  "orgs.metadata": z.strictObject({
    ...checked,
    apiVersion: z.literal(HEADFUL_SALESFORCE_API_VERSION),
    types: z
      .array(
        z.strictObject({
          name: apiName,
          directory: z.string(),
          suffix: z.string().nullable(),
          inFolder: z.boolean(),
          childTypes: z.array(apiName).max(100),
        }),
      )
      .max(1000),
  }),
  "orgs.metadata.components": z.strictObject({
    ...checked,
    apiVersion: z.literal(HEADFUL_SALESFORCE_API_VERSION),
    type: apiName,
    folder: z.string().nullable(),
    completeness: z.literal("not-guaranteed"),
    returnedCount: z.number().int().nonnegative(),
    components: z
      .array(
        z.strictObject({
          name: z.string().max(1000),
          namespace: z.string().nullable(),
          modifiedAt: z.string().nullable(),
          modifiedBy: z.string().nullable(),
          manageableState: z.string().nullable(),
        }),
      )
      .max(500),
    capped: z.boolean(),
  }),
  "orgs.environments": z.strictObject({
    ...checked,
    availability: z.enum(["available", "production-only"]),
    sandboxes: z
      .array(
        z.strictObject({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          license: z.string().nullable(),
          status: z.string().nullable(),
          progress: z.number().min(0).max(100).nullable(),
          requestedAt: z.string().nullable(),
          completedAt: z.string().nullable(),
        }),
      )
      .max(100),
    capped: z.boolean(),
  }),
} as const;
