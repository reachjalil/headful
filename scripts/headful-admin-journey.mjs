/** Focused v1 admin journey. Fictional development data; stops at the first failure. */
import * as NodeModule from "node:module";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import * as NodeAssert from "node:assert/strict";
import { headfulExperiences } from "../packages/contracts/src/headful-experiences.ts";
const require = NodeModule.createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const base = process.env.HEADFUL_URL ?? "http://127.0.0.1:5746";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw new Error("Use a local Headful preview.");
const output = NodePath.resolve(process.env.HEADFUL_ADMIN_EVIDENCE ?? "/tmp/headful-admin-journey");
await NodeFSP.mkdir(output, { recursive: true });
const checks = [],
  errors = [];
const hash = NodeCrypto.createHash("sha256");
for (const path of new Set([
  ...headfulExperiences["admin-workspace"].sources,
  ...headfulExperiences["org-settings"].sources,
  "scripts/headful-admin-journey.mjs",
  "apps/web/src/headful/org-settings/SettingsDisclosure.tsx",
  "apps/web/src/headful/WorkspaceSidebar.tsx",
  "apps/web/src/headful/workspace-theme.css",
  "apps/web/src/headful/fonts/Geist-Variable.woff2",
  "apps/web/src/headful/fonts/GeistMono-Variable.woff2",
]))
  hash.update(path).update(await NodeFSP.readFile(new URL(`../${path}`, import.meta.url)));
const sourceDigest = hash.digest("hex");
const browser = await chromium.launch({ channel: "chrome", headless: true });
let failure;
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 900 },
    colorScheme: "dark",
  });
  page.setDefaultTimeout(8000);
  await page.addInitScript(() => {
    window.__adminNativeCalls = 0;
    window.headfulBridge = {
      dispatch: async () => {
        window.__adminNativeCalls++;
        throw new Error("Unexpected native call from a fixture");
      },
      onNavigate: (listener) => {
        window.__adminNavigate = listener;
        return () => {};
      },
    };
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const pass = (name) => {
    checks.push(name);
    NodeFS.writeFileSync(
      NodePath.resolve(output, "report.json"),
      JSON.stringify(
        { status: "running", surface: "browser-fixture", sourceDigest, checks, errors },
        null,
        2,
      ) + "\n",
    );
    console.log(`Passed: ${name}`);
  };
  const navigate = async (id) => {
    const control = page.getByTestId(id);
    if (!(await control.isVisible()))
      await page.getByRole("button", { name: "Toggle navigation", exact: true }).click();
    await control.click();
  };
  const enterSettings = async () => {
    const control = page.getByRole("button", { name: "Settings", exact: true });
    if (!(await control.isVisible()))
      await page.getByRole("button", { name: "Toggle navigation", exact: true }).click();
    await control.click();
  };
  const open = async (experience, fixture = "ready", step = "") => {
    await page.goto(`${base}/?experience=${experience}&fixture=${fixture}&step=${step}`, {
      waitUntil: "networkidle",
    });
    await page.locator(`[data-experience="${experience}"][aria-busy="false"]`).first().waitFor();
  };
  await open("admin-workspace");
  await page.getByTestId("admin-object-account").click();
  const objectRow = await page.getByTestId("admin-object-account").boundingBox();
  NodeAssert.ok(objectRow && objectRow.height <= 40);
  pass("object rows keep a compact height rather than stretching to fill the explorer pane");
  await page.getByTestId("admin-open-query").click();
  const editor = page.locator('[data-testid="admin-query-editor"]:visible');
  NodeAssert.equal(
    await page.getByRole("heading", { name: "Query results", exact: true }).count(),
    0,
  );
  await editor.fill("SELECT Id, Name FROM Account LIMIT 10");
  await page.getByTestId("admin-tool-health").click();
  await navigate("admin-tool-query");
  NodeAssert.equal(await editor.textContent(), "SELECT Id, Name FROM Account LIMIT 10");
  pass("field selection creates a query without running it; tool changes preserve the draft");
  await page.getByTestId("admin-query-starter").selectOption("Active users");
  NodeAssert.match(await editor.textContent(), /FROM User WHERE IsActive = true/);
  NodeAssert.equal(
    await page.getByRole("heading", { name: "Query results", exact: true }).count(),
    0,
  );
  pass("admin starters replace the editor without automatic provider requests");
  await editor.fill("SELECT Id, Name FROM Account LIMIT 10");
  await page.getByTestId("admin-run-query").click();
  await page.getByRole("heading", { name: "Query results", exact: true }).waitFor();
  await page.getByTestId("admin-query-reference-close").click();
  NodeAssert.equal(await page.getByTestId("admin-query-reference").isVisible(), false);
  NodeAssert.equal(await editor.textContent(), "SELECT Id, Name FROM Account LIMIT 10");
  await page.getByTestId("admin-query-view").focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("admin-query-view-saved").waitFor();
  await page.keyboard.press("Escape");
  NodeAssert.equal(await page.locator(".hf-query-view-menu").getAttribute("open"), null);
  NodeAssert.equal(
    await page
      .getByTestId("admin-query-view")
      .evaluate((control) => document.activeElement === control),
    true,
  );
  await page.getByTestId("admin-query-view").click();
  await page.getByTestId("admin-query-view-saved").click();
  const name = page.getByRole("textbox", { name: "Query name", exact: true });
  await name.waitFor();
  await page.waitForFunction(() => document.activeElement?.closest('[aria-label="Saved queries"]'));
  await name.fill("Accounts ten");
  await page.getByRole("button", { name: "Save query", exact: true }).click();
  await page.getByRole("button", { name: "Accounts ten", exact: true }).waitFor();
  await editor.fill("SELECT Id FROM User LIMIT 3");
  await page.getByText("Editor changed", { exact: true }).waitFor();
  NodeAssert.equal(
    await page.locator(".hf-query-executed code").textContent(),
    "SELECT Id, Name FROM Account LIMIT 10",
  );
  await page.getByRole("button", { name: "Accounts ten", exact: true }).click();
  NodeAssert.equal(await editor.textContent(), "SELECT Id, Name FROM Account LIMIT 10");
  NodeAssert.equal(
    await page.getByRole("heading", { name: "Query results", exact: true }).count(),
    0,
  );
  pass(
    "reference panels preserve drafts; saved queries load without execution; retained results identify their exact executed query",
  );
  await page.getByTestId("admin-query-reference-history").click();
  NodeAssert.equal(
    await page.getByTestId("admin-query-reference-history").getAttribute("aria-selected"),
    "true",
  );
  NodeAssert.equal(
    await page
      .getByTestId("admin-query-reference-history")
      .evaluate((tab) => document.activeElement === tab),
    true,
  );
  await page.locator('[aria-label="Query history"] .hf-utility-history-item').first().waitFor();
  await page.getByTestId("admin-query-view").click();
  await editor.click();
  NodeAssert.equal(await page.locator(".hf-query-view-menu").getAttribute("open"), null);
  await editor.press("Control+Enter");
  await page.getByRole("heading", { name: "Query results", exact: true }).waitFor();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export this page CSV ↓", exact: true }).click();
  const download = await downloadEvent;
  NodeAssert.match(download.suggestedFilename(), /query-page-1\.csv$/);
  pass(
    "View supports keyboard dismissal and outside clicks; the query shortcut runs explicitly and page export remains available",
  );
  await page
    .getByRole("button", { name: "Inspect record 001000000000001AAA", exact: true })
    .click();
  NodeAssert.equal(await page.getByTestId("admin-record-id").inputValue(), "001000000000001AAA");
  await page.getByTestId("admin-inspect-record").click();
  await page.getByTestId("admin-panel-record").getByText("Acme Example", { exact: true }).waitFor();
  pass("query IDs open the exact object and record for an explicit read");
  await open("admin-workspace", "expired");
  await page.getByRole("alert").waitFor();
  await page.getByTestId("admin-tool-record").click();
  await page.getByTestId("admin-record-id").waitFor();
  pass("an unavailable connection shows recovery and leaves alternate tasks reachable");
  await open("admin-workspace", "empty");
  await page.getByRole("heading", { name: "Connect an org to use admin tools" }).waitFor();
  pass("empty workspace explains its connection prerequisite");
  await page.setViewportSize({ width: 430, height: 860 });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await open("admin-workspace");
  await page.getByTestId("admin-object-account").click();
  NodeAssert.equal(
    await page
      .locator(".sf-admin-preview")
      .evaluate((root) => root.scrollWidth <= window.innerWidth),
    true,
  );
  await page.screenshot({ path: NodePath.resolve(output, "admin-narrow.png") });
  pass("430px object explorer contains tables within the workspace");
  await page.locator('[data-testid="admin-tool-query"]:visible').focus();
  await page.keyboard.press("Enter");
  NodeAssert.equal(
    await page.locator('[data-testid="admin-tool-query"]:visible').getAttribute("aria-current"),
    "page",
  );
  const outline = await page
    .getByTestId("admin-tool-query")
    .evaluate((element) => getComputedStyle(element).outlineStyle);
  NodeAssert.notEqual(outline, "none");
  pass("keyboard activation retains visible focus and announces the current task");
  await open("salesforce-setup", "missing", "welcome");
  await page.evaluate(() => window.__adminNavigate("mods?modId=org.example.controls"));
  await page.getByTestId("mods-management").waitFor();
  NodeAssert.equal(await page.getByTestId("mods-install").isDisabled(), true);
  NodeAssert.equal(await page.evaluate(() => window.__adminNativeCalls), 0);
  await navigate("settings-home");
  await page.getByRole("heading", { name: "Welcome to Headful", exact: true }).waitFor();
  pass("native mod navigation works during onboarding; fixtures never invoke native authority");
  await page.setViewportSize({ width: 1100, height: 900 });
  await open("salesforce-setup", "ready", "workspace");
  NodeAssert.equal(await page.locator(".sf-workspace > aside").count(), 0);
  NodeAssert.match(
    await page.getByTestId("org-switcher").getAttribute("aria-label"),
    /alex@acme.example/,
  );
  await page.getByTestId("org-switcher").click();
  await page.getByRole("textbox", { name: "Find an org or login" }).fill("no-such-org");
  await page.getByText("No orgs match “no-such-org”.", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  NodeAssert.equal(await page.locator(".sf-org-switcher").getAttribute("open"), null);
  NodeAssert.equal(
    await page
      .getByTestId("org-switcher")
      .evaluate((control) => document.activeElement === control),
    true,
  );
  pass(
    "top org dropdown identifies the exact login; search and Escape work with the minimal helmet header and no persistent org list",
  );
  await navigate("admin-tool-query");
  await page
    .locator('[data-testid="admin-query-editor"]:visible')
    .fill("SELECT Id FROM User LIMIT 25");
  await page.getByTestId("org-switcher").click();
  await page.getByRole("textbox", { name: "Find an org or login" }).fill("alex@acme.example.dev");
  await page.getByTestId("workspace-org-fixture_development").click();
  await page.getByTestId("settings-page").waitFor();
  NodeAssert.match(
    await page.getByTestId("org-switcher").getAttribute("aria-label"),
    /alex@acme.example, Production/,
  );
  NodeAssert.equal(
    await page
      .getByRole("switch", { name: "Enable Acme Development", exact: true })
      .getAttribute("aria-checked"),
    "false",
  );
  pass(
    "an inactive connection routes to full-page management without silently changing org access",
  );
  await page.getByRole("switch", { name: "Enable Acme Development", exact: true }).click();
  await page.locator('[data-headful-setup][aria-busy="false"]').waitFor();
  await page.getByTestId("org-switcher").click();
  await page.getByTestId("workspace-org-fixture_development").click();
  await page.getByTestId("org-settings-overview").click();
  await page.locator(".os-org-card h3").getByText("Acme Development", { exact: true }).waitFor();
  NodeAssert.equal(await page.getByTestId("org-settings-org").count(), 0);
  await page.getByTestId("org-switcher").click();
  await page.getByTestId("workspace-org-fixture_production").click();
  await page.locator(".os-org-card h3").getByText("Acme", { exact: true }).waitFor();
  pass(
    "workspace and settings share the same top org selector and refresh the exact login context",
  );
  await navigate("settings-home");
  NodeAssert.equal(
    await page.locator('[data-testid="admin-query-editor"]:visible').textContent(),
    "SELECT Id FROM User LIMIT 25",
  );
  await page.getByTestId("org-switcher").click();
  await page.getByTestId("workspace-org-fixture_development").click();
  await navigate("admin-tool-query");
  await page
    .locator('[data-testid="admin-query-editor"]:visible')
    .fill("SELECT Id FROM Account LIMIT 7");
  await page.getByTestId("org-switcher").click();
  await page.getByTestId("workspace-org-fixture_production").click();
  NodeAssert.equal(
    await page.locator('[data-testid="admin-query-editor"]:visible').textContent(),
    "SELECT Id FROM User LIMIT 25",
  );
  await page.getByTestId("org-switcher").click();
  await page.getByTestId("workspace-org-fixture_development").click();
  NodeAssert.equal(
    await page.locator('[data-testid="admin-query-editor"]:visible').textContent(),
    "SELECT Id FROM Account LIMIT 7",
  );
  await page.getByTestId("org-switcher").click();
  await page.getByTestId("workspace-org-fixture_production").click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.locator('[data-headful-setup][aria-busy="false"]').waitFor();
  NodeAssert.equal(
    await page.locator('[data-testid="admin-query-editor"]:visible').textContent(),
    "SELECT Id FROM User LIMIT 25",
  );
  pass("org changes and successful CLI discovery preserve the original org’s draft");
  await page.getByTestId("org-switcher").click();
  await page.screenshot({ path: NodePath.resolve(output, "org-switcher.png") });
  await page.keyboard.press("Escape");
  await enterSettings();
  await page.getByTestId("org-settings-overview").click();
  await page.getByRole("heading", { name: "Org overview", exact: true }).waitFor();
  const identity = page.getByTestId("settings-disclosure-connection-identity");
  NodeAssert.equal(await identity.getAttribute("data-open"), null);
  NodeAssert.equal(await identity.getByText("Org ID", { exact: true }).isVisible(), false);
  NodeAssert.equal(
    await page.getByText("Enabled for this login", { exact: true }).isVisible(),
    true,
  );
  await identity.getByTestId("settings-disclosure-connection-identity-toggle").focus();
  await page.keyboard.press("Enter");
  await identity.locator("[class=os-facts]").waitFor();
  NodeAssert.equal(await identity.getByText("Org ID", { exact: true }).isVisible(), true);
  await page.getByTestId("org-settings-metadata").click();
  await page.getByTestId("org-settings-overview").click();
  NodeAssert.notEqual(await identity.getAttribute("data-open"), null);
  await page.getByTestId("org-switcher").click();
  await page.getByTestId("workspace-org-fixture_development").click();
  await page
    .getByText("Acme Development", { exact: true })
    .filter({ visible: true })
    .last()
    .waitFor();
  NodeAssert.equal(await identity.getAttribute("data-open"), null);
  await page.getByTestId("org-switcher").click();
  await page.getByTestId("workspace-org-fixture_production").click();
  NodeAssert.notEqual(await identity.getAttribute("data-open"), null);
  await identity.getByTestId("settings-disclosure-connection-identity-toggle").click();
  await page.screenshot({
    animations: "disabled",
    path: NodePath.resolve(output, "settings-overview.png"),
  });
  pass(
    "technical identity is disclosed by keyboard; choices persist per topic and exact connection while agent state stays visible",
  );
  await page.getByRole("textbox", { name: "Search settings" }).fill("cli");
  NodeAssert.equal(await page.locator(".sf-navigation-group button").count(), 1);
  await page.getByRole("textbox", { name: "Search settings" }).fill("no-match-here");
  await page.getByText("No settings match.", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Search settings" }).fill("");
  await page.getByTestId("org-settings-environments").click();
  await page.getByRole("heading", { name: "Environment lifecycle", exact: true }).waitFor();
  await page.getByTestId("org-settings-connections").click();
  await page.getByRole("heading", { name: "Org connections", exact: true }).waitFor();
  pass("composed Environments and Connections keep org scope and a single settings page");
  await page.getByTestId("org-settings-overview").click();
  await page.getByTestId("org-settings-mods").click();
  NodeAssert.equal(
    await page.locator('[data-experience="org-settings"]').getAttribute("data-settings-scope"),
    "this-mac",
  );
  await page.getByText("This Mac · Shared across org workspaces", { exact: true }).waitFor();
  NodeAssert.equal(await page.getByRole("dialog").count(), 0);
  NodeAssert.equal(
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Local mods", exact: true })
      .count(),
    1,
  );
  await page.goBack();
  await page.locator('[data-testid="org-settings-overview"][aria-current="page"]').waitFor();
  await page.goForward();
  await page.locator('[data-testid="org-settings-mods"][aria-current="page"]').waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-testid="org-settings-mods"][aria-current="page"]').waitFor();
  await navigate("settings-home");
  NodeAssert.equal(await page.getByTestId("settings-page").count(), 0);
  NodeAssert.equal(
    await page
      .getByRole("button", { name: "Settings", exact: true })
      .evaluate((button) => document.activeElement === button),
    true,
  );
  pass(
    "settings search, selected topics, browser back/forward and reload work; returning home restores trigger focus",
  );
  await navigate("admin-tool-backup");
  await page.getByRole("button", { name: "Choose cloud protection", exact: true }).waitFor();
  await page
    .getByText("Cloud backups continue without this Mac or an open browser.", { exact: false })
    .waitFor();
  pass("Backup & Recovery opens its cloud destination without granting cloud authority");
  await page.screenshot({ path: NodePath.resolve(output, "workspace.png") });
  await navigate("admin-tool-query");
  await page.locator('[data-testid="admin-query-reference-fields"]:visible').click();
  await page
    .locator('[data-testid="admin-query-editor"]:visible')
    .fill("SELECT Id, Name FROM Account LIMIT 50");
  await page.locator('[data-testid="admin-run-query"]:visible').click();
  await page.getByRole("heading", { name: "Query results", exact: true }).waitFor();
  const geometry = await page.locator(".sf-org-workspace:not([hidden])").evaluate((root) => {
    const box = root.getBoundingClientRect();
    const result = root.querySelector(".hf-query-results").getBoundingClientRect();
    const editor = root.querySelector(".hf-code-surface").getBoundingClientRect();
    return {
      bottom: box.bottom,
      resultBottom: result.bottom,
      editorHeight: editor.height,
      resultHeight: result.height,
      overflow: root.scrollWidth > root.clientWidth,
      appScroll:
        document.querySelector(".sf-main").scrollHeight >
        document.querySelector(".sf-main").clientHeight + 1,
    };
  });
  NodeAssert.equal(geometry.overflow, false);
  NodeAssert.equal(geometry.appScroll, false);
  NodeAssert.ok(
    geometry.editorHeight >= 150 &&
      geometry.resultHeight >= 300 &&
      geometry.resultBottom <= geometry.bottom + 1,
  );
  await page.screenshot({ path: NodePath.resolve(output, "editor-desktop.png") });
  pass(
    "desktop editor and results use the available height; navigation and org status remain fixed without page overflow",
  );
  await page.setViewportSize({ width: 430, height: 860 });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await open("salesforce-setup", "ready", "workspace");
  NodeAssert.equal(
    await page.locator(".sf-app").evaluate((root) => root.scrollWidth <= window.innerWidth),
    true,
  );
  await navigate("admin-tool-query");
  await page.locator('[data-testid="admin-run-query"]:visible').click();
  await page.getByRole("heading", { name: "Query results", exact: true }).waitFor();
  await page.getByTestId("admin-query-view").click();
  const viewMenu = await page.locator(".hf-query-view-options").boundingBox();
  NodeAssert.ok(viewMenu && viewMenu.x >= 0 && viewMenu.x + viewMenu.width <= 430);
  await page.keyboard.press("Escape");
  NodeAssert.equal(
    await page
      .locator(".sf-app")
      .evaluate(
        (root) =>
          root.scrollHeight <= root.clientHeight + 1 && root.scrollWidth <= root.clientWidth,
      ),
    true,
  );
  await page.screenshot({ path: NodePath.resolve(output, "editor-narrow.png") });
  pass(
    "430px query workspace docks the reference below results and contains both the editor and View menu",
  );
  await page.getByTestId("org-switcher").click();
  const picker = await page.locator(".sf-org-picker").boundingBox();
  NodeAssert.ok(picker && picker.x >= 0 && picker.x + picker.width <= 430);
  await page.screenshot({ path: NodePath.resolve(output, "org-switcher-narrow.png") });
  await page.locator(".sf-page-bar").click();
  NodeAssert.equal(await page.locator(".sf-org-switcher").getAttribute("open"), null);
  pass("430px org dropdown is contained; clicking outside closes it");
  await enterSettings();
  await navigate("org-settings-limits");
  await page.getByTestId("org-settings-usage-limits").click();
  NodeAssert.match(
    await page.getByRole("navigation", { name: "Current location" }).innerText(),
    /Settings.*Licenses & usage.*Org limits/s,
  );
  pass("nested Settings breadcrumb reflects the chosen usage view");
  await page.locator('[data-experience="org-settings"][aria-busy="false"]').waitFor();
  NodeAssert.equal(
    await page
      .locator(".sf-settings-page")
      .evaluate((root) => root.scrollWidth <= root.clientWidth),
    true,
  );
  NodeAssert.equal(
    await page.getByRole("navigation", { name: "Settings sections" }).isVisible(),
    false,
  );
  NodeAssert.equal(
    await page.getByTestId("org-settings-limits").getAttribute("aria-current"),
    "page",
  );
  const scroll = await page.locator(".os-main").evaluate((main) => ({
    overflow: getComputedStyle(main).overflowY,
    height: main.clientHeight,
    pageOverflow:
      document.querySelector(".sf-settings-page").scrollHeight >
      document.querySelector(".sf-settings-page").clientHeight + 1,
  }));
  NodeAssert.equal(scroll.overflow, "auto");
  NodeAssert.ok(scroll.height > 400 && !scroll.pageOverflow);
  await page.screenshot({ path: NodePath.resolve(output, "settings-narrow.png") });
  pass("430px composed workspace and licensing settings have no page overflow");
  await page.getByRole("button", { name: "Reset / replay", exact: true }).click();
  NodeAssert.equal(await page.getByTestId("settings-page").count(), 0);
  await page.getByTestId("admin-tool-schema").waitFor({ state: "attached" });
  pass("reset/replay from settings returns to the explicit workspace starting state");
  await page.setViewportSize({ width: 1440, height: 950 });
  await enterSettings();
  await page.getByTestId("org-settings-overview").click();
  await page.getByRole("heading", { name: "Org overview", exact: true }).waitFor();
  await page.waitForFunction(() => document.fonts.check("13px Geist"));
  NodeAssert.equal(await page.locator(".sf-header img").isVisible(), true);
  NodeAssert.equal(await page.locator(".sf-header .sf-view-nav").count(), 0);
  NodeAssert.equal(await page.locator(".os-layout > nav").count(), 0);
  NodeAssert.equal(await page.getByRole("navigation", { name: "Settings sections" }).count(), 1);
  const frame = await page.evaluate(() => {
    const header = document.querySelector(".sf-header").getBoundingClientRect();
    const bar = document.querySelector(".sf-page-bar").getBoundingClientRect();
    return {
      headerHeight: header.height,
      sameRow: Math.abs(header.top - bar.top) < 1,
      font: getComputedStyle(document.querySelector(".os-settings")).fontFamily,
      background: getComputedStyle(document.querySelector(".sf-app")).backgroundColor,
    };
  });
  NodeAssert.equal(frame.headerHeight, 48);
  NodeAssert.equal(frame.sameRow, true);
  NodeAssert.match(frame.font, /Geist/);
  NodeAssert.equal(frame.background, "rgb(0, 0, 0)");
  pass(
    "one 48px helmet/org/breadcrumb row, one sidebar and bundled Geist fonts replace the previous header",
  );
  await page.screenshot({
    animations: "disabled",
    path: NodePath.resolve(output, "settings-overview.png"),
  });
  await page.getByTestId("org-settings-metadata").click();
  await page.getByTestId("org-settings-type-customobject").click();
  NodeAssert.match(
    await page.getByRole("navigation", { name: "Current location" }).innerText(),
    /Metadata.*CustomObject/s,
  );
  await page
    .getByRole("navigation", { name: "Current location" })
    .getByRole("button", { name: "Metadata", exact: true })
    .click();
  NodeAssert.doesNotMatch(
    await page.getByRole("navigation", { name: "Current location" }).innerText(),
    /CustomObject/,
  );
  pass("metadata selection adds a breadcrumb depth and its parent returns to the type list");
  await page.getByTestId("org-settings-limits").click();
  await page.getByTestId("org-settings-usage-limits").click();
  await page.locator('[data-experience="org-settings"][aria-busy="false"]').waitFor();
  await page.screenshot({
    animations: "disabled",
    path: NodePath.resolve(output, "settings-usage.png"),
  });
  await navigate("settings-home");
  await page.getByTestId("admin-tool-query").click();
  await page.locator('[data-testid="admin-query-editor"]:visible').waitFor();
  await page.screenshot({
    animations: "disabled",
    path: NodePath.resolve(output, "editor-desktop.png"),
  });
  await page.getByRole("textbox", { name: "Find workspace tool" }).fill("health");
  NodeAssert.equal(await page.locator('[data-testid^="admin-tool-"]:visible').count(), 1);
  await page.getByRole("textbox", { name: "Find workspace tool" }).fill("");
  pass("the workspace sidebar can find tools without opening Settings");
  NodeAssert.deepEqual(errors, []);
  pass("no browser runtime errors across the journey");
} catch (error) {
  failure = error.message;
  throw error;
} finally {
  const report = {
    status: failure ? "failed" : "passed",
    surface: "browser-fixture",
    sourceDigest,
    checks,
    errors,
    failure,
    limits:
      "Fictional data in Chrome. Native UI, live Salesforce and installer updates are not established by this journey.",
  };
  await NodeFSP.writeFile(
    NodePath.resolve(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
