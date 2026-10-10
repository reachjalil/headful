// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { headfulExperiences } from "@t3tools/contracts/headful-experiences";
import { compileRecipe } from "./ControlProtocol.ts";

const root = new URL("../../../../", import.meta.url);

/** Every experience in code is wired consistently before any browser or native run. */
describe.each(Object.entries(headfulExperiences))("experience %s", (id, definition) => {
  it("has existing sources and a recipe that compiles under the native rules", () => {
    for (const path of [...definition.sources, definition.recipe])
      expect(NodeFS.existsSync(new URL(path, root)), path).toBe(true);
    const steps = compileRecipe(NodeFS.readFileSync(new URL(definition.recipe, root), "utf8"));
    const fixtures: readonly string[] = definition.fixtures;
    const declaredSteps: readonly string[] = definition.steps;
    const flows = new Set<string>();
    for (const step of steps) {
      if (step.method === "flow" && "id" in step.input) flows.add(step.input.id);
      if (step.method === "mock" && "fixture" in step.input && flows.size === 0)
        expect(fixtures, `fixture ${step.input.fixture}`).toContain(step.input.fixture);
      if (step.method === "assert" && "path" in step.input && step.input.path === "step")
        expect(declaredSteps, `step ${String(step.input.equals)}`).toContain(step.input.equals);
    }
    if (id !== "initial") expect([...flows]).toEqual([id]);
  });
});
