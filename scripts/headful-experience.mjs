/**
 * Run saved experience recipes against the isolated development preview in Chrome.
 *
 *   node scripts/headful-experience.mjs <experience> [<experience> ...]
 *
 * Uses the same restricted recipe compiler as native desktop control, so one recipe
 * produces browser fixture evidence here and native evidence through a paired grant.
 * Stops on the first failure and never retries. No Salesforce requests are made.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { headfulExperiences } from "../packages/contracts/src/headful-experiences.ts";
import { compileRecipe } from "../apps/desktop/src/headful/ControlProtocol.ts";

const require = NodeModule.createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const root = new URL("../", import.meta.url);
const base = process.env.HEADFUL_URL ?? "http://127.0.0.1:5746";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw new Error("Use a local Headful development preview.");
const ids = process.argv.slice(2);
if (!ids.length) {
  console.error(`Usage: headful:experience <${Object.keys(headfulExperiences).join("|")}> ...`);
  process.exit(2);
}
for (const id of ids)
  if (!Object.hasOwn(headfulExperiences, id)) throw new Error(`Unknown experience: ${id}`);
const evidenceRoot = NodePath.resolve(
  process.env.HEADFUL_EVIDENCE ?? NodePath.join(NodeOS.tmpdir(), "headful-experience"),
);

const browser = await chromium.launch({ channel: "chrome", headless: true });
let failed = false;
try {
  for (const id of ids) {
    const definition = headfulExperiences[id];
    const recipe = await NodeFSP.readFile(new URL(definition.recipe, root), "utf8");
    const steps = compileRecipe(recipe);
    const hash = NodeCrypto.createHash("sha256");
    for (const path of [...definition.sources, definition.recipe])
      hash.update(path).update(await NodeFSP.readFile(new URL(path, root)));
    const output = NodePath.join(evidenceRoot, id);
    await NodeFSP.rm(output, { recursive: true, force: true });
    await NodeFSP.mkdir(output, { recursive: true });

    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    page.setDefaultTimeout(8000);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const started = performance.now();
    await page.goto(`${base}/?experience=initial`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => typeof window.__headfulExperienceControl === "function");
    const results = [];
    let captures = 0;
    const capture = async () => {
      const file = `${String(++captures).padStart(2, "0")}.png`;
      await page.screenshot({ path: NodePath.join(output, file) });
      return file;
    };
    for (const step of steps) {
      const at = performance.now();
      try {
        let result;
        if (step.method === "screenshot") result = { capture: await capture() };
        else if (step.method === "record") {
          const frames = [];
          for (let i = 0; i < step.input.frames; i++) {
            if (i) await page.waitForTimeout(step.input.intervalMs);
            frames.push(await capture());
          }
          result = { frames };
        } else if (step.method === "press") await page.keyboard.press(step.input.key);
        else if (step.method === "scroll") await page.mouse.wheel(0, step.input.deltaY);
        else if (step.method === "diagnostics") result = { surface: "browser-fixture" };
        else
          result = await page.evaluate(
            ([method, input]) => window.__headfulExperienceControl(method, input),
            [step.method, step.input],
          );
        if (pageErrors.length) throw new Error(`Page error: ${pageErrors.join("; ")}`);
        results.push({ ...step, ms: Math.round(performance.now() - at), result });
      } catch (error) {
        results.push({
          ...step,
          ms: Math.round(performance.now() - at),
          error: String(error.message ?? error),
        });
        failed = true;
        break;
      }
    }
    await page.close();
    const report = {
      experience: id,
      record: definition.record,
      exposure: definition.exposure,
      surface: "browser-fixture",
      status: failed ? "failed" : "passed",
      sourceDigest: hash.digest("hex"),
      recipe: definition.recipe,
      durationMs: Math.round(performance.now() - started),
      steps: results,
      limits: "Fictional fixtures in Chrome. Not native, live Salesforce or packaged evidence.",
    };
    await NodeFSP.writeFile(
      NodePath.join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    const last = results.at(-1);
    console.log(
      `${report.status.toUpperCase()} ${id} · ${results.length}/${steps.length} steps · ${report.durationMs} ms · ${captures} captures · ${output}` +
        (failed
          ? `\n  stopped at ${last.method} ${JSON.stringify(last.input)}: ${last.error}`
          : ""),
    );
    if (failed) break;
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
