// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import { parse } from "acorn";
import { z } from "zod";
import {
  experienceFixtures,
  experienceIds,
  experienceControlTestIdPattern,
} from "@t3tools/contracts/headful-experiences";

export const controlActions = {
  diagnostics: z.strictObject({}),
  state: z.strictObject({}),
  screenshot: z.strictObject({}),
  flow: z.strictObject({ id: z.enum(experienceIds) }),
  mock: z.strictObject({ fixture: z.enum(experienceFixtures) }),
  reset: z.strictObject({}),
  click: z.strictObject({ testId: z.string().regex(experienceControlTestIdPattern) }),
  type: z.strictObject({
    testId: z.string().regex(experienceControlTestIdPattern),
    text: z.string().max(1000),
  }),
  press: z.strictObject({
    key: z.enum([
      "Tab",
      "Enter",
      "Escape",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Backspace",
    ]),
  }),
  scroll: z.strictObject({ deltaY: z.number().int().min(-2000).max(2000) }),
  assert: z.strictObject({
    path: z.enum(["flow", "fixture", "step", "empty", "controls", "alerts"]),
    equals: z.union([z.string().max(100), z.boolean(), z.number().int()]),
  }),
  record: z.strictObject({
    frames: z.number().int().min(2).max(12),
    intervalMs: z.number().int().min(100).max(1000),
  }),
} as const;
export type ControlAction = keyof typeof controlActions;
export const controlScopes = ["diagnostics", "inspect", "capture", "interact", "fixtures"] as const;
export type ControlScope = (typeof controlScopes)[number];
export const scopeFor = (method: ControlAction): ControlScope => {
  if (method === "diagnostics") return "diagnostics";
  if (method === "state" || method === "assert") return "inspect";
  if (method === "screenshot" || method === "record") return "capture";
  if (method === "flow" || method === "mock" || method === "reset") return "fixtures";
  return "interact";
};

// This is a deliberately small code-mode language, not a JavaScript sandbox.
// Acorn parses the whole recipe before any effect. Only literal JSON arguments
// to `await app.method(...)` are accepted; no eval, loops, imports or Node ports.
export function compileRecipe(code: string) {
  if (code.length > 16_000) throw new Error("Recipe is too large.");
  const ast = parse(code, { ecmaVersion: "latest", allowAwaitOutsideFunction: true });
  if (ast.body.length === 0 || ast.body.length > 24) throw new Error("Use 1–24 explicit steps.");
  return ast.body.map((statement) => {
    if (statement.type !== "ExpressionStatement" || statement.expression.type !== "AwaitExpression")
      throw new Error("Each step must be await app.method({...});");
    const call = statement.expression.argument;
    if (
      call.type !== "CallExpression" ||
      call.callee.type !== "MemberExpression" ||
      call.callee.computed ||
      call.callee.object.type !== "Identifier" ||
      call.callee.object.name !== "app" ||
      call.callee.property.type !== "Identifier"
    )
      throw new Error("Only typed app methods are allowed.");
    const method = call.callee.property.name;
    if (!Object.hasOwn(controlActions, method) || call.arguments.length > 1)
      throw new Error("Unknown app method.");
    const arg = call.arguments[0];
    const input: unknown = arg ? JSON.parse(code.slice(arg.start, arg.end)) : {};
    return {
      method: method as ControlAction,
      input: controlActions[method as ControlAction].parse(input),
    };
  });
}

export async function runRecipe(
  code: string,
  scopes: readonly ControlScope[],
  dev: boolean,
  execute: (method: ControlAction, input: unknown) => Promise<unknown>,
) {
  const steps = compileRecipe(code);
  for (const step of steps) {
    if (!scopes.includes(scopeFor(step.method)))
      throw new Error(`Scope required: ${scopeFor(step.method)}`);
    if (!dev && step.method !== "diagnostics") throw new Error("App control is development-only.");
  }
  const frames = steps.reduce(
    (count, step) =>
      count +
      (step.method === "record" && "frames" in step.input
        ? step.input.frames
        : step.method === "screenshot"
          ? 1
          : 0),
    0,
  );
  if (frames > 12) throw new Error("Use at most 12 capture frames per recipe.");
  const results: { method: ControlAction; result?: unknown; error?: string }[] = [];
  for (const step of steps) {
    try {
      results.push({ method: step.method, result: await execute(step.method, step.input) });
    } catch (error) {
      results.push({
        method: step.method,
        error: error instanceof Error ? error.message : "Step failed.",
      });
      return { status: "failed" as const, results };
    }
  }
  return { status: "passed" as const, results };
}
