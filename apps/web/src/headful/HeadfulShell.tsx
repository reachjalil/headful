import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { flushSync } from "react-dom";
import {
  experienceFixtures,
  headfulExperiences,
  type ExperienceFixture,
  type ExperienceId,
} from "@t3tools/contracts/headful-experiences";
import type { ExperienceState } from "./experience-control";
import type { ExperiencePreviewProps } from "./experience-views";
import { SalesforceSetup } from "./SalesforceSetup";
import "./initial-canvas.css";
import { useTheme } from "../hooks/useTheme";

interface HeadfulBridge {
  dispatch(operation: string, input: unknown): Promise<unknown>;
  onNavigate?(listener: (route: string) => void): () => void;
  experienceControl?(code: string): Promise<unknown>;
}
declare global {
  interface Window {
    headfulBridge?: HeadfulBridge;
  }
}

type Isolate = { flow: ExperienceId; fixture: ExperienceFixture; step: string; revision: number };

/** `?experience=<id>&fixture=<name>&step=<step>` opens one isolated development preview. */
function isolateFromQuery(): Isolate | null {
  const query = new URLSearchParams(location.search);
  const id = query.get("experience");
  if (!id || !Object.hasOwn(headfulExperiences, id)) return null;
  const definition = headfulExperiences[id as ExperienceId];
  const fixtures: readonly string[] = definition.fixtures;
  const steps: readonly string[] = definition.steps;
  const fixture = query.get("fixture") ?? "ready";
  const step = query.get("step") ?? definition.steps[0];
  return {
    flow: id as ExperienceId,
    fixture: (fixtures.includes(fixture) ? fixture : "ready") as ExperienceFixture,
    step: steps.includes(step) ? step : definition.steps[0],
    revision: 0,
  };
}

/** Normal startup composes Salesforce setup, the admin workspace and settings. Development adds isolated experience previews. */
export function HeadfulShell() {
  useTheme();
  const [isolate, setIsolate] = useState<Isolate | null>(() =>
    import.meta.env.DEV ? isolateFromQuery() : null,
  );
  const [step, setStep] = useState("");
  const [loaded, setLoaded] = useState<{
    flow: ExperienceId;
    Preview: ComponentType<ExperiencePreviewProps>;
  } | null>(null);
  const current = useRef({ isolate, step });
  useLayoutEffect(() => {
    current.current = { isolate, step };
  });
  const onStepChange = useCallback((next: string) => setStep(next), []);
  const flow = isolate?.flow;

  useEffect(() => {
    if (!import.meta.env.DEV || !flow || flow === "initial") return;
    let active = true;
    void import("./experience-views").then(async ({ experiencePreviews }) => {
      const Preview = await experiencePreviews[flow]();
      if (active) setLoaded({ flow, Preview });
    });
    return () => {
      active = false;
    };
  }, [flow]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let uninstall: (() => void) | undefined;
    let disposed = false;
    void import("./experience-control").then(({ installExperienceControl }) => {
      if (disposed) return;
      uninstall = installExperienceControl(
        (): ExperienceState => {
          const view = current.current.isolate;
          const root = document.querySelector<HTMLElement>("[data-experience]");
          return {
            flow: view?.flow ?? "salesforce-setup",
            fixture: view?.fixture ?? experienceFixtures[0],
            step: root?.dataset.experienceStep ?? current.current.step,
            empty: view?.flow === "initial",
            controls: document.querySelectorAll("[data-testid]").length,
            alerts: document.querySelectorAll('[role="alert"]').length,
          };
        },
        async (input) => {
          if (input.flow)
            history.replaceState(
              { ...history.state, headfulOrgId: null, headfulNavigation: { view: "home" } },
              "",
            );
          const base = current.current.isolate ??
            isolateFromQuery() ?? {
              flow: "initial" as const,
              fixture: "missing" as const,
              step: "open-window",
              revision: 0,
            };
          const next = { ...base, ...input, revision: base.revision + 1 };
          if (next.flow !== "initial") {
            const { experiencePreviews } = await import("./experience-views");
            const Preview = await experiencePreviews[next.flow]();
            flushSync(() => setLoaded({ flow: next.flow, Preview }));
          }
          flushSync(() => setIsolate(next));
          if (next.flow === "initial") return;
          await new Promise<void>((resolve, reject) => {
            const deadline = performance.now() + 5000;
            const check = () => {
              if (document.querySelector(`[data-experience="${next.flow}"][aria-busy="false"]`))
                resolve();
              else if (performance.now() >= deadline)
                reject(new Error("Experience fixture did not become ready."));
              else requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
          });
        },
        async (code) => {
          if (!window.headfulBridge?.experienceControl)
            throw new Error("Native development control unavailable.");
          return window.headfulBridge.experienceControl(code);
        },
      );
    });
    return () => {
      disposed = true;
      uninstall?.();
    };
  }, []);

  if (import.meta.env.DEV && isolate?.flow === "initial")
    return (
      <main
        data-headful-canvas=""
        data-experience="initial"
        data-experience-step="open-window"
        aria-label="Headful"
      >
        <div data-headful-indicator="" role="status" aria-label="Initial loading indicator" />
      </main>
    );
  if (import.meta.env.DEV && isolate)
    return loaded?.flow === isolate.flow ? (
      <loaded.Preview
        key={`${isolate.flow}:${isolate.fixture}:${isolate.revision}`}
        fixture={isolate.fixture}
        step={isolate.step}
        onStepChange={onStepChange}
      />
    ) : (
      <div role="status">Opening experience preview…</div>
    );
  return <SalesforceSetup onStepChange={onStepChange} />;
}
