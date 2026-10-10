/** Actual pointer/keyboard editor manipulation. Synthetic reads only; stop at first failure. */
import * as NodeModule from "node:module";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import { headfulExperiences } from "../packages/contracts/src/headful-experiences.ts";
const require = NodeModule.createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const base = process.env.HEADFUL_URL ?? "http://127.0.0.1:5746";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw Error("Use a local preview.");
const output = NodePath.resolve(
  process.env.HEADFUL_MANIPULATION_EVIDENCE ?? "/tmp/headful-editor-manipulation",
);
await NodeFSP.mkdir(output, { recursive: true });
const hash = NodeCrypto.createHash("sha256");
for (const file of new Set([
  ...headfulExperiences["admin-workspace"].sources,
  ...headfulExperiences["reference-mod"].sources,
]))
  hash.update(file).update(await NodeFSP.readFile(new URL(`../${file}`, import.meta.url)));
const sourceDigest = hash.digest("hex"),
  checks = [],
  errors = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
let failure, page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__manipulationNativeCalls = 0;
    window.headfulBridge = {
      dispatch: async () => {
        window.__manipulationNativeCalls++;
        throw Error("Unexpected native call.");
      },
    };
  });
  const pass = (name) => checks.push(name);
  const capture = (name) => page.screenshot({ path: NodePath.join(output, `${name}.png`) });
  const active = () => page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  const tabs = page.getByRole("tablist", { name: "Workspace tools", exact: true });
  const order = () => tabs.getByRole("tab").allTextContents();
  const dragStart = async (locator) => {
    const b = await locator.boundingBox();
    NodeAssert.ok(b, "drag source is visible");
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 18, b.y + b.height / 2 + 25, { steps: 6 });
  };
  const drop = async (locator) => {
    const b = await locator.boundingBox();
    NodeAssert.ok(b, "drop target is visible");
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
    await page.mouse.up();
  };
  await page.goto(`${base}/?experience=reference-mod&fixture=ready`, {
    waitUntil: "domcontentloaded",
  });
  const document = page.getByRole("article", { name: "Local counter", exact: true });
  await document.locator(".katex-mathml math").first().waitFor();
  const originalOrder = await order();
  NodeAssert.ok(
    originalOrder.some((text) => text.includes("Local counter")),
    "opened mod gets a workspace tab",
  );
  await page.getByTestId("admin-tool-query").click();
  const editor = page.getByTestId("admin-query-editor");
  await editor.fill("SELECT Id, Name FROM Account LIMIT 25");
  await page.getByTestId("admin-run-query").click();
  await page.getByRole("heading", { name: "Query results", exact: true }).waitFor();
  const mountedEditor = await editor.elementHandle();
  await page.getByTestId("admin-tool-query").focus();
  await page.keyboard.press("ArrowRight");
  NodeAssert.equal(await active(), "admin-tool-record");
  NodeAssert.equal(
    await page.getByTestId("admin-tool-query").getAttribute("aria-selected"),
    "true",
  );
  await page.keyboard.press("Enter");
  await page.getByTestId("admin-panel-record").waitFor();
  await page.getByTestId("admin-tool-query").click();
  pass("tabs move focus manually; Enter activates a tool and revisiting retains the query");
  await page.keyboard.press("Alt+ArrowRight");
  const keyboardOrder = await order();
  NodeAssert.ok(
    keyboardOrder.findIndex((t) => t.includes("Inspect record")) <
      keyboardOrder.findIndex((t) => t.includes("Query data")),
  );
  await page.keyboard.press("Alt+Home");
  NodeAssert.deepEqual(await order(), originalOrder);
  await page.keyboard.press("Shift+F10");
  await page.getByRole("button", { name: "Move tab left", exact: true }).click();
  NodeAssert.equal(await active(), "admin-tool-query");
  NodeAssert.ok((await order())[0].includes("Query data"));
  await page.keyboard.press("Alt+Home");
  pass(
    "Alt arrows, Alt Home and tab options reorder tabs and restore focus without selecting another tool",
  );
  await page
    .getByTestId("admin-tool-query")
    .dragTo(page.getByTestId("admin-tool-health"), { targetPosition: { x: 10, y: 12 } });
  NodeAssert.ok((await order())[1].includes("Inspect record"));
  NodeAssert.ok((await order())[2].includes("Query data"));
  NodeAssert.equal(
    await page.getByTestId("admin-tool-query").getAttribute("aria-selected"),
    "true",
  );
  pass(
    "native pointer dragging reorders workspace tabs without recreating content or activating the drop target",
  );
  await page.getByTestId("admin-query-reference-fields").focus();
  await page.keyboard.press("ArrowRight");
  NodeAssert.equal(await active(), "admin-query-reference-saved");
  NodeAssert.equal(
    await page.getByTestId("admin-query-reference-fields").getAttribute("aria-selected"),
    "true",
  );
  await page.keyboard.press("Enter");
  NodeAssert.equal(await active(), "admin-query-reference-saved");
  await page.getByRole("textbox", { name: "Query name", exact: true }).waitFor();
  await page.getByTestId("admin-query-reference-fields").click();
  pass(
    "reference tabs retain focus on activation so arrows navigate tabs and Tab enters the selected panel",
  );
  await page.getByRole("button", { name: "Read fields", exact: true }).click();
  await page.getByRole("button", { name: "Name (Name), string", exact: true }).waitFor();
  await page
    .getByTestId("admin-query-reference-fields")
    .dragTo(page.getByTestId("admin-query-reference-history"), {
      targetPosition: { x: 45, y: 12 },
    });
  NodeAssert.ok(
    (
      await page
        .getByRole("tablist", { name: "Query reference panels" })
        .getByRole("tab")
        .allTextContents()
    )
      .at(-1)
      .includes("Fields"),
  );
  NodeAssert.equal(
    await page.getByTestId("admin-query-reference-fields").getAttribute("aria-selected"),
    "true",
  );
  pass("reference tabs reorder independently while preserving loaded field suggestions");
  await dragStart(page.getByTestId("admin-query-reference-fields"));
  await page.getByTestId("admin-query-drop-left").waitFor();
  await capture("query-drop-targets");
  await drop(page.getByTestId("admin-query-drop-left"));
  await page.waitForFunction(
    () => document.querySelector(".hf-query-layout")?.getAttribute("data-dock") === "left",
  );
  let reference = await page.getByTestId("admin-query-reference").boundingBox(),
    main = await page.locator(".hf-query-main").boundingBox();
  NodeAssert.ok(reference.x + reference.width < main.x);
  const sideDivider = page.getByTestId("admin-query-reference-divider");
  const startSize = Number(await sideDivider.getAttribute("aria-valuenow"));
  const rb = await sideDivider.boundingBox();
  await page.mouse.move(rb.x + 3, rb.y + 60);
  await page.mouse.down();
  await page.mouse.move(rb.x + 63, rb.y + 60, { steps: 12 });
  await page.waitForFunction(
    (v) =>
      Number(
        document
          .querySelector('[data-testid="admin-query-reference-divider"]')
          .getAttribute("aria-valuenow"),
      ) > v,
    startSize,
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  NodeAssert.equal(Number(await sideDivider.getAttribute("aria-valuenow")), startSize);
  NodeAssert.equal(await sideDivider.getAttribute("data-resizing"), null);
  pass(
    "reference docks left by pointer and Escape restores the starting size during a captured resize",
  );
  await dragStart(page.getByTestId("admin-query-reference-history"));
  await page.getByTestId("admin-query-drop-bottom").waitFor();
  await drop(page.getByTestId("admin-query-drop-bottom"));
  await page.waitForFunction(
    () => document.querySelector(".hf-query-layout")?.getAttribute("data-dock") === "bottom",
  );
  reference = await page.getByTestId("admin-query-reference").boundingBox();
  main = await page.locator(".hf-query-main").boundingBox();
  NodeAssert.ok(main.y + main.height < reference.y);
  NodeAssert.equal(
    await page.getByTestId("admin-query-reference-history").getAttribute("aria-selected"),
    "true",
  );
  NodeAssert.equal(await sideDivider.getAttribute("aria-orientation"), "horizontal");
  await sideDivider.focus();
  await page.keyboard.press("Shift+ArrowUp");
  NodeAssert.equal(await sideDivider.getAttribute("aria-valuenow"), "39");
  NodeAssert.equal(await editor.innerText(), "SELECT Id, Name FROM Account LIMIT 25");
  NodeAssert.equal(
    await mountedEditor.evaluate(
      (el) => el.isConnected && el === document.querySelector('[data-testid="admin-query-editor"]'),
    ),
    true,
  );
  NodeAssert.equal(
    await page.getByRole("heading", { name: "Query results", exact: true }).count(),
    1,
  );
  await capture("query-docked-below");
  pass(
    "reference docks below with a working height divider; the original editor node, draft and results survive both moves",
  );
  await page.getByTestId("admin-query-view").click();
  await page.getByTestId("admin-query-dock-right").click();
  NodeAssert.equal(await page.locator(".hf-query-layout").getAttribute("data-dock"), "right");
  await page.getByTestId("admin-query-view").click();
  await page.getByTestId("admin-query-layout-reset").click();
  NodeAssert.deepEqual(
    await page
      .getByRole("tablist", { name: "Query reference panels" })
      .getByRole("tab")
      .allTextContents(),
    ["Fields", "Saved", "History"],
  );
  pass("View offers keyboard-accessible docking and resets reference order, position and sizes");
  await page.getByTestId("editor-tools-menu").click();
  await page.getByTestId("editor-tool-org.example.hello/counter").click();
  const sourceTab = page.getByTestId("editor-document-source"),
    previewTab = page.getByTestId("editor-document-preview");
  await dragStart(sourceTab);
  await page.getByTestId("editor-document-dock-right").waitFor();
  await capture("document-drop-targets");
  await drop(page.getByTestId("editor-document-dock-right"));
  await page.getByTestId("editor-document-source-editor").waitFor();
  const documentSource = page.locator(".sf-editor-mod-view .hf-document-source");
  NodeAssert.ok((await document.boundingBox()).x < (await documentSource.boundingBox()).x);
  NodeAssert.equal(
    await page.getByTestId("editor-document-split").getAttribute("aria-selected"),
    "true",
  );
  NodeAssert.equal(await document.locator(".katex-mathml math").count(), 2);
  await capture("document-preview-first");
  pass("dragging Source to the right opens split with preview first and intact accessible math");
  await previewTab.click();
  await dragStart(sourceTab);
  await page.getByTestId("editor-document-dock-left").waitFor();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="editor-document-preview"]')
        ?.getAttribute("aria-selected") === "true",
  );
  NodeAssert.equal(await documentSource.isVisible(), false);
  pass("Escape cancels a native document drag and restores the original Preview view");
  await page.getByTestId("editor-document-layout").click();
  await page.getByTestId("editor-document-source-first").click();
  NodeAssert.ok((await documentSource.boundingBox()).x < (await document.boundingBox()).x);
  const docDivider = page.getByTestId("editor-document-divider");
  await docDivider.focus();
  await page.keyboard.press("End");
  NodeAssert.equal(await docDivider.getAttribute("aria-valuenow"), "75");
  await docDivider.dblclick();
  NodeAssert.equal(await docDivider.getAttribute("aria-valuenow"), "50");
  pass(
    "document Layout places panes without dragging and bounded divider controls reset to a balanced split",
  );
  await page.setViewportSize({ width: 430, height: 860 });
  await docDivider.focus();
  NodeAssert.equal(await docDivider.getAttribute("aria-orientation"), "horizontal");
  await page.keyboard.press("Shift+ArrowDown");
  NodeAssert.equal(await docDivider.getAttribute("aria-valuenow"), "55");
  NodeAssert.ok((await documentSource.boundingBox()).y < (await document.boundingBox()).y);
  NodeAssert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await capture("document-narrow");
  await page.getByTestId("admin-tool-query").click();
  NodeAssert.equal(await sideDivider.getAttribute("aria-orientation"), "horizontal");
  await sideDivider.focus();
  await page.keyboard.press("Shift+ArrowUp");
  NodeAssert.equal(await sideDivider.getAttribute("aria-valuenow"), "39");
  NodeAssert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await capture("query-narrow");
  pass(
    "430px documents and query reference stack with working height dividers and no viewport overflow",
  );
  NodeAssert.equal(await page.getByRole("dialog").count(), 0);
  NodeAssert.equal(await page.evaluate(() => window.__manipulationNativeCalls), 0);
  NodeAssert.deepEqual(errors, []);
  pass("all manipulation remains local without dialogs, native bridge calls or browser errors");
} catch (e) {
  failure = e instanceof Error ? e.message : String(e);
  if (page) await page.screenshot({ path: NodePath.join(output, "failure.png") }).catch(() => {});
} finally {
  await browser.close();
}
await NodeFSP.writeFile(
  NodePath.join(output, "report.json"),
  JSON.stringify(
    {
      status: failure ? "failed" : "passed",
      sourceDigest,
      checks,
      errors,
      failure: failure ?? null,
      fixturesOnly: true,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    status: failure ? "failed" : "passed",
    checks: checks.length,
    failure: failure ?? null,
    sourceDigest,
    output,
  }),
);
if (failure) process.exitCode = 1;
