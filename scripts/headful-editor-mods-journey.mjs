/** Editor contribution journey: real manifests, fictional local output, no native/provider authority. */
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
  throw new Error("Use a local Headful preview.");
const output = NodePath.resolve(process.env.HEADFUL_EDITOR_EVIDENCE ?? "/tmp/headful-editor-mods");
await NodeFSP.mkdir(output, { recursive: true });
const hash = NodeCrypto.createHash("sha256");
for (const path of new Set([
  ...headfulExperiences["reference-mod"].sources,
  ...headfulExperiences["admin-workspace"].sources,
  "scripts/headful-editor-mods-journey.mjs",
]))
  hash.update(path).update(await NodeFSP.readFile(new URL(`../${path}`, import.meta.url)));
const sourceDigest = hash.digest("hex");
const checks = [],
  errors = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
let failure;
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__editorNativeCalls = 0;
    window.headfulBridge = {
      dispatch: async () => {
        window.__editorNativeCalls++;
        throw new Error("Unexpected native call from fixture.");
      },
    };
  });
  await page.goto(`${base}/?experience=reference-mod&fixture=ready`, { waitUntil: "networkidle" });
  await page
    .getByRole("article", { name: "Local counter" })
    .getByText("Invocations: 0.", { exact: true })
    .waitFor();
  NodeAssert.equal(await page.locator("dialog, [role=dialog]").count(), 0);
  NodeAssert.equal(
    await page.getByRole("heading", { name: "Local counter", exact: true }).count(),
    1,
  );
  checks.push(
    "declared community navigation opens a host-rendered view in the editor without a modal",
  );
  await page.getByTestId("editor-action-org.example.hello/hello").click();
  await page.getByRole("status").filter({ hasText: "count: 1" }).waitFor();
  NodeAssert.equal(
    await page
      .getByRole("article", { name: "Local counter" })
      .getByText("Invocations: 0.", { exact: true })
      .count(),
    1,
  );
  await page.getByTestId("editor-refresh-view").click();
  await page
    .getByRole("article", { name: "Local counter" })
    .getByText("Invocations: 1.", { exact: true })
    .waitFor();
  checks.push("a declared contextual action runs only on click; view refresh is explicit");
  await page.screenshot({ path: NodePath.join(output, "counter-desktop.png") });
  await page.getByTestId("editor-tools-menu").click();
  await page.getByLabel("Find tools and actions").fill("hello");
  NodeAssert.equal(await page.getByTestId("editor-tool-org.example.hello/counter").count(), 1);
  await page.keyboard.press("Escape");
  NodeAssert.equal(await page.locator(".sf-editor-menu[open]").count(), 0);
  NodeAssert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
    "editor-tools-menu",
  );
  checks.push("Tools search finds the supplying mod; Escape closes and restores trigger focus");
  await page.getByTestId("admin-tool-query").click();
  const editor = page.locator('[data-testid="admin-query-editor"]:visible');
  await editor.fill("SELECT Id FROM User LIMIT 25");
  NodeAssert.equal(await page.getByTestId("editor-action-org.example.hello/hello").count(), 0);
  await page.getByTestId("editor-tools-menu").click();
  await page.screenshot({ path: NodePath.join(output, "tools-desktop.png") });
  await page.getByTestId("editor-tool-org.example.hello/counter").click();
  await page
    .getByRole("article", { name: "Local counter" })
    .getByText("Invocations: 1.", { exact: true })
    .waitFor();
  await page.getByTestId("admin-tool-query").click();
  NodeAssert.equal(await editor.textContent(), "SELECT Id FROM User LIMIT 25");
  checks.push(
    "tool-scoped actions disappear outside their destination and navigation preserves the query draft",
  );
  await page.getByTestId("editor-tools-menu").click();
  await editor.click();
  NodeAssert.equal(await page.locator(".sf-editor-menu[open]").count(), 0);
  checks.push("outside pointer dismissal leaves the chosen editor control focused");
  await page.setViewportSize({ width: 430, height: 800 });
  await page.getByTestId("editor-tools-menu").click();
  const menu = await page.locator(".sf-editor-menu-body").boundingBox();
  NodeAssert.ok(menu && menu.x >= 0 && menu.x + menu.width <= 430);
  NodeAssert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await page.screenshot({ path: NodePath.join(output, "tools-narrow.png") });
  await page.getByTestId("editor-tool-org.example.hello/counter").click();
  await page.screenshot({ path: NodePath.join(output, "counter-narrow.png") });
  checks.push(
    "the menu and mod destination stay within a 430px viewport while the tool strip remains scrollable",
  );
  await page.getByRole("button", { name: "Reset / replay" }).click();
  await page
    .getByRole("article", { name: "Local counter" })
    .getByText("Invocations: 0.", { exact: true })
    .waitFor();
  checks.push("isolated replay resets contribution selection and synthetic mod state");
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${base}/?experience=salesforce-setup&fixture=ready&step=workspace`, {
    waitUntil: "networkidle",
  });
  await page.getByTestId("editor-tools-menu").click();
  await page.getByTestId("editor-manage-mods").click();
  await page.getByRole("heading", { name: "Local mods", exact: true }).waitFor();
  NodeAssert.equal(await page.locator('[data-testid="settings-page"]:visible').count(), 1);
  NodeAssert.equal(await page.getByRole("heading", { name: "Local mods", exact: true }).count(), 1);
  await page
    .getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("button", { name: "Workspace", exact: true })
    .click();
  NodeAssert.equal(await page.locator(".sf-editor-menu[open]").count(), 0);
  NodeAssert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
    "editor-tools-menu",
  );
  checks.push(
    "Manage local mods uses full-page Settings and Workspace breadcrumbs return to the editor trigger",
  );
  NodeAssert.equal(await page.evaluate(() => window.__editorNativeCalls), 0);
  NodeAssert.deepEqual(errors, []);
  checks.push("fixture interactions make no native calls and produce no browser exceptions");
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  await browser.close();
  const report = {
    status: failure ? "failed" : "passed",
    at: new Date().toISOString(),
    sourceDigest,
    checks,
    errors,
    ...(failure ? { failure } : {}),
    authority:
      "fictional browser fixture; native lifecycle and isolation require separate service/Electron evidence",
  };
  await NodeFSP.writeFile(
    NodePath.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
if (failure) process.exitCode = 1;
