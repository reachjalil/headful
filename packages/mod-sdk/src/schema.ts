/** Deliberately small JSON schema vocabulary. No refs, executable validators or coercion. */
export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
export type ValueSchema = {
  type: "null" | "boolean" | "number" | "string" | "array" | "object";
  properties?: Record<string, ValueSchema>;
  required?: string[];
  items?: ValueSchema;
  maxLength?: number;
  maxItems?: number;
};
export class ModError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ModError";
    this.code = code;
  }
}
export function serializable(value: unknown): Value {
  const text = JSON.stringify(value);
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > 262144)
    throw new ModError("message_limit", "A mod message must be JSON and at most 256 KiB.");
  const visit = (item: unknown, depth = 0): void => {
    if (depth > 16) throw new ModError("message_depth", "JSON nesting exceeds 16.");
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (Array.isArray(item) && item.length <= 2048) {
      item.forEach((x) => visit(x, depth + 1));
      return;
    }
    if (
      item &&
      typeof item === "object" &&
      Object.getPrototypeOf(item) === Object.prototype &&
      Object.keys(item).length <= 256
    ) {
      for (const [key, entry] of Object.entries(item)) {
        if (["__proto__", "constructor", "prototype"].includes(key))
          throw new ModError("message_key", "Unsafe JSON key.");
        visit(entry, depth + 1);
      }
      return;
    }
    throw new ModError("message_invalid", "Transport only plain serializable values.");
  };
  visit(value);
  return JSON.parse(text) as Value;
}
export function validateSchema(schema: ValueSchema, depth = 0): void {
  if (
    !schema ||
    depth > 8 ||
    !["null", "boolean", "number", "string", "array", "object"].includes(schema.type) ||
    Object.keys(schema).some(
      (k) => !["type", "properties", "required", "items", "maxLength", "maxItems"].includes(k),
    )
  )
    throw new ModError("schema_invalid", "Unsupported or excessive schema.");
  if (
    schema.maxLength !== undefined &&
    (!Number.isInteger(schema.maxLength) || schema.maxLength < 0 || schema.maxLength > 30000)
  )
    throw new ModError("schema_invalid", "maxLength must be between 0 and 30000.");
  if (
    schema.maxItems !== undefined &&
    (!Number.isInteger(schema.maxItems) || schema.maxItems < 0 || schema.maxItems > 2048)
  )
    throw new ModError("schema_invalid", "maxItems must be between 0 and 2048.");
  if (schema.type === "object") {
    if (
      !schema.properties ||
      Object.keys(schema.properties).length > 64 ||
      (schema.required ?? []).some((k) => !Object.hasOwn(schema.properties!, k))
    )
      throw new ModError("schema_invalid", "Object schemas require bounded declared properties.");
    Object.values(schema.properties).forEach((s) => validateSchema(s, depth + 1));
  }
  if (schema.type === "array") {
    if (!schema.items) throw new ModError("schema_invalid", "Array schemas require items.");
    validateSchema(schema.items, depth + 1);
  }
}
export function validateValue(schema: ValueSchema, value: unknown): Value {
  validateSchema(schema);
  const result = serializable(value);
  const check = (s: ValueSchema, v: Value): void => {
    const type = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
    if (type !== s.type) throw new ModError("input_invalid", `Expected ${s.type}.`);
    if (typeof v === "string" && v.length > (s.maxLength ?? 30000))
      throw new ModError("input_invalid", "String exceeds schema limit.");
    if (Array.isArray(v)) {
      if (v.length > (s.maxItems ?? 2048))
        throw new ModError("input_invalid", "Array exceeds schema limit.");
      v.forEach((x) => check(s.items!, x));
    } else if (v !== null && typeof v === "object") {
      if (
        Object.keys(v).some((k) => !Object.hasOwn(s.properties!, k)) ||
        (s.required ?? []).some((k) => !Object.hasOwn(v, k))
      )
        throw new ModError("input_invalid", "Object properties do not match the schema.");
      Object.entries(v).forEach(([k, x]) => check(s.properties![k]!, x));
    }
  };
  check(schema, result);
  return result;
}
