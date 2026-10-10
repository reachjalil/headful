import { z } from "zod";
import { headfulUtilityInputSchemas } from "./headful-utilities.ts";

/** Structured native Salesforce work. The host supplies the verified target and
 * query cancellation identity; callers never choose an executable or CLI flags. */
export const salesforceTaskStepSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("query"),
    input: headfulUtilityInputSchemas["utilities.query.run"]
      .omit({ orgId: true, requestId: true })
      .extend({ query: z.string().trim().min(1).max(5000) }),
  }),
  z.strictObject({
    action: z.literal("list-objects"),
    input: headfulUtilityInputSchemas["utilities.objects.list"].omit({ orgId: true }),
  }),
  z.strictObject({
    action: z.literal("describe-object"),
    input: headfulUtilityInputSchemas["utilities.objects.describe"].omit({ orgId: true }),
  }),
  z.strictObject({
    action: z.literal("diagnostics"),
    input: headfulUtilityInputSchemas["utilities.diagnostics"].omit({ orgId: true }),
  }),
  z.strictObject({
    action: z.literal("list-apex-logs"),
    input: headfulUtilityInputSchemas["utilities.logs.list"].omit({ orgId: true }),
  }),
  z.strictObject({
    action: z.literal("read-apex-log"),
    input: headfulUtilityInputSchemas["utilities.logs.get"].omit({ orgId: true }),
  }),
]);
export const salesforceTaskStepsSchema = z.array(salesforceTaskStepSchema).min(1).max(4);
export const salesforceTaskActions = [
  "query",
  "list-objects",
  "describe-object",
  "diagnostics",
  "list-apex-logs",
  "read-apex-log",
] as const;
export type SalesforceTaskStep = z.output<typeof salesforceTaskStepSchema>;
export const salesforceTaskOperations = {
  query: { operation: "utilities.query.run", capability: "query:read" },
  "list-objects": { operation: "utilities.objects.list", capability: "schema:read" },
  "describe-object": { operation: "utilities.objects.describe", capability: "schema:read" },
  diagnostics: { operation: "utilities.diagnostics", capability: "diagnostics:read" },
  "list-apex-logs": { operation: "utilities.logs.list", capability: "diagnostics:read" },
  "read-apex-log": { operation: "utilities.logs.get", capability: "diagnostics:read" },
} as const;
