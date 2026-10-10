/** IDE content journey. Labeled synthetic reads only; stop on the first failure. */
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
  process.env.HEADFUL_CONTENT_EVIDENCE ?? "/tmp/headful-editor-content",
);
await NodeFSP.mkdir(output, { recursive: true });
const hash = NodeCrypto.createHash("sha256");
for (const path of new Set([
  ...headfulExperiences["admin-workspace"].sources,
  ...headfulExperiences["reference-mod"].sources,
  "scripts/headful-editor-content-journey.mjs",
  "pnpm-workspace.yaml",
]))
  hash.update(path).update(await NodeFSP.readFile(new URL(`../${path}`, import.meta.url)));
const sourceDigest = hash.digest("hex");
const checks = [],
  errors = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
let failure;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__contentNativeCalls = 0;
    window.headfulBridge = {
      dispatch: async () => {
        window.__contentNativeCalls++;
        throw Error("Unexpected native call.");
      },
    };
  });
  const capture = (name) => page.screenshot({ path: NodePath.join(output, `${name}.png`) });
  const pass = (name) => checks.push(name);
  const mod = await page.evaluate(() =>
    navigator.platform.startsWith("Mac") ? "Meta" : "Control",
  );
  await page.goto(`${base}/?experience=reference-mod&fixture=ready`, {
    waitUntil: "domcontentloaded",
  });
  const document = page.getByRole("article", { name: "Local counter", exact: true });
  await document.waitFor();
  await document.locator(".katex-mathml math").first().waitFor();
  NodeAssert.equal(await document.locator(".katex-mathml math").count(), 2);
  NodeAssert.equal(await document.locator("table tbody tr").count(), 2);
  NodeAssert.equal(await document.locator("script, iframe, img, a").count(), 0);
  pass(
    "mod documents render tables, code and accessible inline/display math without active embedded content",
  );
  await page.getByTestId("editor-document-split").click();
  const source = page.getByTestId("editor-document-source-editor");
  NodeAssert.equal(await source.getAttribute("contenteditable"), "false");
  const sourceBox = await page.locator(".sf-editor-mod-view .hf-document-source").boundingBox(),
    previewBox = await document.boundingBox();
  NodeAssert.ok(sourceBox && previewBox && sourceBox.x + sourceBox.width <= previewBox.x + 1);
  const documentDivider = page.getByTestId("editor-document-divider");
  await documentDivider.focus();
  await page.keyboard.press("Shift+ArrowRight");
  const widerSource = await page.locator(".sf-editor-mod-view .hf-document-source").boundingBox();
  NodeAssert.ok(widerSource.width > sourceBox.width + 30);
  await documentDivider.dblclick();
  NodeAssert.equal(await documentDivider.getAttribute("aria-valuenow"), "50");
  pass("document split resizes from the keyboard and resets without reloading source or preview");
  await capture("document-desktop");
  await page.getByTestId("editor-document-source").click();
  NodeAssert.equal(await document.isVisible(), false);
  await page.getByTestId("editor-document-preview").click();
  NodeAssert.equal(await document.isVisible(), true);
  pass(
    "Source, Split and Preview keep one loaded read-only document and use adjacent desktop panes",
  );
  await page.getByTestId("admin-tool-query").click();
  const editor = page.getByTestId("admin-query-editor");
  await page.getByRole("button", { name: "Read fields", exact: true }).click();
  await page.getByRole("button", { name: "Name (Name), string", exact: true }).waitFor();
  await editor.fill("SELECT Na");
  await page.keyboard.press("Control+Space");
  await page.getByRole("option", { name: /^Name/ }).waitFor();
  await page.keyboard.press("Enter");
  NodeAssert.equal(await editor.innerText(), "SELECT Name");
  NodeAssert.equal(
    await page.getByRole("heading", { name: "Query results", exact: true }).count(),
    0,
  );
  await page.keyboard.press(`${mod}+z`);
  NodeAssert.equal(await editor.innerText(), "SELECT Na");
  await page.keyboard.press(`${mod}+Shift+z`);
  NodeAssert.equal(await editor.innerText(), "SELECT Name");
  pass("loaded field completion, undo and redo edit the draft without executing it");
  await page.keyboard.press(`${mod}+f`);
  await page.locator('.cm-search input[name="search"]').fill("Name");
  await page.keyboard.press("Escape");
  NodeAssert.equal(await page.locator(".cm-search:visible").count(), 0);
  await editor.fill("SELECT Id, Name\nFROM Account\nLIMIT 50");
  NodeAssert.ok((await editor.locator("span").count()) > 0);
  NodeAssert.ok(
    (await page.locator(".hf-query-composer .cm-lineNumbers .cm-gutterElement").count()) >= 3,
  );
  await page.keyboard.press(`${mod}+Enter`);
  await page.getByRole("heading", { name: "Query results", exact: true }).waitFor();
  NodeAssert.equal(
    await page.locator(".hf-query-executed code").textContent(),
    "SELECT Id, Name\nFROM Account\nLIMIT 50",
  );
  pass(
    "inline find closes with Escape; highlighted multiline source runs only through explicit Cmd/Ctrl Enter",
  );
  const divider = page.getByTestId("admin-query-divider");
  await divider.focus();
  await page.keyboard.press("Shift+ArrowDown");
  NodeAssert.equal(await divider.getAttribute("aria-valuenow"), "45");
  const dividerBox = await divider.boundingBox();
  await page.mouse.move(dividerBox.x + 50, dividerBox.y + 2);
  await page.mouse.down();
  await page.mouse.move(dividerBox.x + 50, dividerBox.y + 40);
  await page.mouse.up();
  NodeAssert.ok(Number(await divider.getAttribute("aria-valuenow")) > 45);
  await capture("query-desktop");
  pass("the code/results divider resizes by keyboard and pointer without moving org navigation");
  const referenceDivider = page.getByTestId("admin-query-reference-divider");
  const referenceBefore = await page.getByTestId("admin-query-reference").boundingBox();
  const referenceEdge = await referenceDivider.boundingBox();
  await page.mouse.move(referenceEdge.x + 3, referenceEdge.y + 40);
  await page.mouse.down();
  await page.mouse.move(referenceEdge.x - 65, referenceEdge.y + 40);
  await page.mouse.up();
  NodeAssert.ok(
    (await page.getByTestId("admin-query-reference").boundingBox()).width >
      referenceBefore.width + 40,
  );
  await page.getByTestId("admin-query-view").click();
  await page.getByTestId("admin-query-layout-reset").click();
  await page.waitForFunction(() => !!document.activeElement?.closest(".hf-query-reference"));
  NodeAssert.equal(await referenceDivider.getAttribute("aria-valuenow"), "23");
  NodeAssert.equal(await divider.getAttribute("aria-valuenow"), "40");
  NodeAssert.equal(await editor.innerText(), "SELECT Id, Name\nFROM Account\nLIMIT 50");
  NodeAssert.equal(
    await page.getByRole("heading", { name: "Query results", exact: true }).count(),
    1,
  );
  pass(
    "query reference resizes by pointer and View resets both docks while retaining draft and results",
  );
  await editor.click();
  await editor.fill("SELECT Id FROM User LIMIT 25");
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText("x".repeat(20001));
  await page.getByRole("status").filter({ hasText: "Limit: 20000 characters" }).waitFor();
  NodeAssert.equal(await editor.innerText(), "SELECT Id FROM User LIMIT 25");
  await page.getByTestId("admin-tool-health").click();
  await page.getByTestId("admin-health-jobs").click();
  NodeAssert.equal(
    await page.getByRole("heading", { name: "Recent jobs", exact: true }).isVisible(),
    true,
  );
  NodeAssert.equal(
    await page.getByRole("heading", { name: "Storage", exact: true }).isVisible(),
    false,
  );
  await page.getByTestId("admin-health-logs").click();
  NodeAssert.equal(await page.getByRole("button", { name: "Read log", exact: true }).count(), 0);
  await page.getByRole("button", { name: "List available logs", exact: true }).click();
  await page.getByText("No accessible debug logs.", { exact: false }).waitFor();
  NodeAssert.equal(await page.getByRole("button", { name: "Read log", exact: true }).count(), 0);
  await page.getByTestId("admin-health-overview").click();
  await page.getByTestId("admin-health-logs").click();
  NodeAssert.equal(
    await page.getByText("No accessible debug logs.", { exact: false }).isVisible(),
    true,
  );
  pass(
    "health views group diagnostics; explicit listing returns the fixture empty-log state and survives view switches",
  );
  await page.getByTestId("admin-tool-query").click();
  NodeAssert.equal(await editor.innerText(), "SELECT Id FROM User LIMIT 25");
  pass("oversized edits are refused with visible feedback; tool navigation preserves valid work");
  await page.getByTestId("admin-tool-schema").click();
  const objectRow = await page.getByTestId("admin-object-account").boundingBox();
  NodeAssert.ok(
    objectRow && objectRow.height <= 36,
    "object rows remain compact rather than stretching to fill the dock",
  );
  await page.getByTestId("admin-object-account").click();
  await page.getByLabel("Field kind").selectOption("formula");
  NodeAssert.equal(await page.locator(".hf-utility-detail .hf-utility-table tbody tr").count(), 1);
  await page.getByTestId("admin-inspect-field-annual-revenue-band--c").click();
  const formula = page.getByTestId("admin-field-formula");
  NodeAssert.equal(await formula.getAttribute("aria-readonly"), "true");
  NodeAssert.match(await formula.innerText(), /IF\(AnnualRevenue/);
  NodeAssert.equal(await page.getByRole("dialog").count(), 0);
  const propertiesDivider = page.getByTestId("admin-properties-divider");
  const properties = page.getByRole("complementary", { name: "Field inspector" });
  const propertiesBefore = await properties.boundingBox();
  await propertiesDivider.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  NodeAssert.ok((await properties.boundingBox()).width > propertiesBefore.width + 30);
  await page.keyboard.press("End");
  NodeAssert.equal(await propertiesDivider.getAttribute("aria-valuenow"), "38");
  await propertiesDivider.dblclick();
  const objectDivider = page.getByTestId("admin-objects-divider");
  const objectsBefore = await page
    .getByRole("complementary", { name: "Object browser" })
    .boundingBox();
  await objectDivider.focus();
  await page.keyboard.press("Shift+ArrowRight");
  NodeAssert.ok(
    (await page.getByRole("complementary", { name: "Object browser" }).boundingBox()).width >
      objectsBefore.width + 30,
  );
  await objectDivider.dblclick();
  const formulaGroup = properties.locator(".hf-field-formula summary");
  await formulaGroup.click();
  NodeAssert.equal(await formula.isVisible(), false);
  await formulaGroup.click();
  NodeAssert.equal(await formula.isVisible(), true);
  pass(
    "object and Properties docks resize with bounded keyboard controls; formula groups reopen with source intact",
  );
  NodeAssert.equal(
    await page
      .getByRole("complementary", { name: "Field inspector" })
      .getByRole("button", { name: "Wrap", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await capture("formula-desktop");
  await page.getByRole("button", { name: "Close field inspector" }).click();
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("data-testid") ===
      "admin-inspect-field-annual-revenue-band--c",
  );
  NodeAssert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
    "admin-inspect-field-annual-revenue-band--c",
  );
  pass(
    "calculated-field filtering opens wrapped read-only formula source in place and closing restores field focus",
  );
  await page.getByTestId("admin-schema-documentation").click();
  const schema = page.getByRole("article", { name: "Account field documentation", exact: true });
  NodeAssert.equal(await schema.locator("tbody tr").count(), 7);
  NodeAssert.match(await schema.innerText(), /00D000000000001/);
  await page.getByTestId("admin-schema-document-split").click();
  await capture("schema-document-desktop");
  pass(
    "schema documentation renders the exact org's readable field metadata beside its Markdown source",
  );
  await page.setViewportSize({ width: 430, height: 860 });
  await page.getByTestId("admin-schema-fields").click();
  await page.getByTestId("admin-inspect-field-annual-revenue-band--c").click();
  NodeAssert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await capture("formula-narrow");
  await page.getByTestId("admin-tool-query").click();
  NodeAssert.equal(await editor.innerText(), "SELECT Id FROM User LIMIT 25");
  NodeAssert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await capture("query-narrow");
  pass("430px formula and query panes stay inside the viewport and keep the query draft");
  await page.getByTestId("editor-tools-menu").click();
  await page.getByTestId("editor-tool-org.example.hello/counter").click();
  await page.getByTestId("editor-document-split").click();
  const narrowSource = await page.locator(".sf-editor-mod-view .hf-document-source").boundingBox(),
    narrowPreview = await document.boundingBox();
  NodeAssert.ok(
    narrowSource && narrowPreview && narrowSource.y + narrowSource.height <= narrowPreview.y + 1,
  );
  NodeAssert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await capture("document-narrow");
  pass("split documents dock vertically on narrow windows with independent scrolling");
  await page.getByRole("button", { name: "Reset / replay", exact: true }).click();
  await document.getByText("Invocations: 0.", { exact: true }).waitFor();
  NodeAssert.equal(
    await page.getByTestId("editor-document-preview").getAttribute("aria-selected"),
    "true",
  );
  NodeAssert.equal(await page.evaluate(() => window.__contentNativeCalls), 0);
  NodeAssert.deepEqual(errors, []);
  pass("reset restores the starting document; no native calls or browser runtime errors occurred");
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
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
    sourceDigest,
    checks: checks.length,
    failure: failure ?? null,
    output,
  }),
);
if (failure) process.exitCode = 1;
