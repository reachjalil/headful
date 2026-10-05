/* Adapted from Headful Cloud (Apache-2.0); see LICENSES/Headful-Cloud-Apache-2.0.txt. */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import { createHash, randomBytes } from "node:crypto";
import type { z } from "zod";
import type { Env } from "./types.ts";
export {
  identifier,
  sfId,
} from "../../../../../packages/contracts/src/headful-workspace/contract-schema.ts";
export const now = () => Effect.runSync(Clock.currentTimeMillis);
export const currentIso = () => DateTime.formatIso(DateTime.makeUnsafe(now()));
export const httpDate = (value: string) =>
  DateTime.toDateUtc(DateTime.makeUnsafe(value)).toUTCString();
export const random = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const hash = async (value: string) => createHash("sha256").update(value).digest("base64url");
/** CRM workflow records are local SQLite data, not a duplicate Salesforce-token vault. */
export const seal = async (_env: Env, binding: string, value: unknown) =>
  JSON.stringify({ binding, value });
export const unseal = async <T>(
  _: Env,
  binding: string,
  envelope: string,
  schema: z.ZodType<T>,
): Promise<T> => {
  const stored = JSON.parse(envelope) as { binding: string; value: unknown };
  if (stored.binding !== binding) throw new Error("Workflow binding mismatch");
  return schema.parse(stored.value);
};
export const audit = async (
  env: Env,
  _owner: string,
  kind: string,
  orgId: string,
  targetId: string,
) => env.DB.activity(kind, orgId, targetId);
