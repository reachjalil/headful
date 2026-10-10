import { flushSync } from "react-dom";
import { EditorView } from "@codemirror/view";
import {
  experienceFixtures,
  experienceControlTestIdPattern,
  headfulExperiences,
  type ExperienceFixture,
  type ExperienceId,
} from "@t3tools/contracts/headful-experiences";
export type ExperienceState = {
  flow: ExperienceId;
  fixture: ExperienceFixture;
  step: string;
  empty: boolean;
  controls: number;
  alerts: number;
};
type ModelContext = {
  registerTool(tool: {
    name: string;
    description: string;
    inputSchema: object;
    execute(input: Record<string, unknown>): Promise<unknown>;
  }): void;
  unregisterTool(name: string): void;
};

declare global {
  interface Window {
    __headfulExperienceControl?: (
      method: string,
      input: Record<string, unknown>,
    ) => Promise<unknown>;
  }
}

/** Include visible Suspense/read boundaries so recipes never capture a loading surface as ready. */
async function settled(timeout = 5000) {
  const deadline = performance.now() + timeout;
  for (;;) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const root = document.querySelector("[data-experience]");
    const loading =
      root &&
      [root, ...root.querySelectorAll('[aria-busy="true"]')].some(
        (element) => element.getAttribute("aria-busy") === "true" && !element.closest("[hidden]"),
      );
    if (!loading) return;
    if (performance.now() >= deadline) throw new Error("Experience did not settle.");
  }
}

/** Wait for the named control to mount; dispatch the requested action only once. */
async function visibleControl(testId: string, timeout = 5000) {
  const deadline = performance.now() + timeout;
  for (;;) {
    const element = [...document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)].find(
      (candidate) => !candidate.closest("[hidden]"),
    );
    if (element) return element;
    if (performance.now() >= deadline)
      throw new Error("Control not found in the current experience.");
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

export function installExperienceControl(
  read: () => ExperienceState,
  update: (input: Partial<ExperienceState>) => Promise<void>,
  authorize: (code: string) => Promise<unknown>,
) {
  const control = async (method: string, input: Record<string, unknown>) => {
    if (method === "flow") {
      if (!Object.hasOwn(headfulExperiences, String(input.id)))
        throw new Error("Unknown experience.");
      const definition = headfulExperiences[input.id as ExperienceId];
      const fixtures: readonly string[] = definition.fixtures;
      if (!fixtures.includes(read().fixture))
        throw new Error(`Fixture ${read().fixture} is not defined for ${String(input.id)}.`);
      await update({ flow: input.id as ExperienceId, step: definition.steps[0] });
    } else if (method === "mock") {
      if (!(experienceFixtures as readonly string[]).includes(String(input.fixture)))
        throw new Error("Unknown fixture.");
      await update({ fixture: input.fixture as ExperienceFixture });
    } else if (method === "reset")
      await update({ flow: "initial", fixture: "missing", step: "open-window" });
    else if (method === "click" || method === "type") {
      if (typeof input.testId !== "string" || !experienceControlTestIdPattern.test(input.testId))
        throw new Error("Use a stable test ID.");
      const element = await visibleControl(input.testId);
      if (method === "click") flushSync(() => element.click());
      else {
        if (typeof input.text !== "string") throw new Error("Input not editable.");
        const editor = element.closest(".cm-editor") ? EditorView.findFromDOM(element) : null;
        if (editor && element.getAttribute("aria-readonly") !== "true") {
          editor.focus();
          flushSync(() =>
            editor.dispatch({
              changes: { from: 0, to: editor.state.doc.length, insert: String(input.text) },
            }),
          );
        } else if (element instanceof HTMLInputElement) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
            element,
            input.text,
          );
          flushSync(() => element.dispatchEvent(new Event("input", { bubbles: true })));
        } else throw new Error("Input not editable.");
      }
      await settled();
    } else if (method === "assert") {
      const state = read();
      if (
        !Object.hasOwn(state, String(input.path)) ||
        state[input.path as keyof ExperienceState] !== input.equals
      )
        throw new Error(`Assertion failed: ${String(input.path)}`);
      return { matched: true, state };
    } else if (method !== "state") throw new Error("Unknown experience operation.");
    return read();
  };
  window.__headfulExperienceControl = control;
  const modelContext = (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
  const tools = [
    {
      name: "headful_experience_state",
      description: "Inspect the active Headful development experience.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => authorize("await app.state();"),
    },
    {
      name: "headful_experience_recipe",
      description:
        "Run explicit typed app steps, fixtures and evidence capture after native consent. Development only.",
      inputSchema: {
        type: "object",
        properties: { code: { type: "string", maxLength: 16000 } },
        required: ["code"],
        additionalProperties: false,
      },
      execute: (input: Record<string, unknown>) => {
        if (typeof input.code !== "string") throw new Error("Recipe required.");
        return authorize(input.code);
      },
    },
  ];
  const registered: string[] = [];
  if (modelContext)
    for (const tool of tools) {
      try {
        modelContext.registerTool(tool);
        registered.push(tool.name);
      } catch {
        /* Optional browser capability; desktop MCP remains authoritative. */
      }
    }
  return () => {
    delete window.__headfulExperienceControl;
    for (const name of registered) modelContext?.unregisterTool(name);
  };
}
