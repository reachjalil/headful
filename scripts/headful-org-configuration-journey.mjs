/** Focused integrated configuration recipe. Fictional orgs, fresh profile, no native/provider authority. */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const require = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const base = process.env.HEADFUL_SETUP_URL ?? "http://127.0.0.1:5746";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw new Error("Use an isolated loopback development preview.");
const output = path.resolve(
  process.env.HEADFUL_CONFIGURATION_EVIDENCE ?? "/tmp/headful-org-configuration",
);
await mkdir(output, { recursive: true });
const files = [
  "apps/web/src/headful/OrgSwitcher.tsx",
  "apps/web/src/headful/CliSetup.tsx",
  "apps/web/src/headful/Appearance.tsx",
  "apps/web/src/headful/SetupGuide.tsx",
  "apps/web/src/headful/SalesforceSetup.tsx",
  "apps/web/src/headful/workspace-theme.css",
  "apps/web/src/headful/HeadfulShell.tsx",
  "apps/web/src/headful/org-settings/OrgSettings.tsx",
  "apps/web/src/headful/org-settings/settings-navigation.ts",
  "apps/web/index.html",
  "scripts/headful-org-configuration-journey.mjs",
];
const hash = createHash("sha256");
for (const file of files)
  hash.update(file).update(await readFile(new URL("../" + file, import.meta.url)));
const report = {
  sourceDigest: hash.digest("hex"),
  fixture: "fictional, development-only",
  checks: [],
  status: "running",
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  colorScheme: "dark",
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const capture = (name) => page.screenshot({ path: path.join(output, `${name}.png`) });
const check = async (name, action) => {
  await action();
  report.checks.push(name);
};
const open = async (fixture = "ready", step = "workspace") => {
  await page.goto(`${base}/?experience=salesforce-setup&fixture=${fixture}&step=${step}`, {
    waitUntil: "networkidle",
  });
  await page.locator('[data-headful-setup][aria-busy="false"]').waitFor();
};
const settings = (id) => page.getByTestId(`org-settings-${id}`).click();
try {
  await open();
  await check("keyboard org search and exact login selection", async () => {
    await page.getByTestId("org-switcher").click();
    assert.equal(
      await page.getByLabel("Find an org or login").evaluate((e) => document.activeElement === e),
      true,
    );
    await page.getByLabel("Find an org or login").fill("alex@acme.example");
    await page.getByLabel("Find an org or login").press("ArrowDown");
    assert.equal(
      await page
        .getByTestId("workspace-org-fixture_production")
        .evaluate((e) => document.activeElement === e),
      true,
    );
    await capture("picker-dark");
    await page.keyboard.press("Escape");
    assert.equal(
      await page.getByTestId("org-switcher").evaluate((e) => document.activeElement === e),
      true,
    );
  });
  await check("unavailable connection opens management without enabling it", async () => {
    await page.getByTestId("org-switcher").click();
    await page.getByTestId("workspace-org-fixture_development").click();
    await page.getByRole("heading", { name: "Org connections", exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("switch", { name: "Enable Acme Development", exact: true })
        .getAttribute("aria-checked"),
      "false",
    );
    await page.getByLabel("Find a connection").fill("alex@acme.example.dev");
    assert.equal(await page.locator(".sf-org-row").count(), 1);
    await page.getByRole("button", { name: "Clear connection search" }).click();
    await capture("connections-dark");
  });
  await check("browser login destination is disclosed only when needed", async () => {
    await page.getByRole("button", { name: "Add org", exact: true }).click();
    assert.equal(await page.getByLabel("Salesforce HTTPS address").count(), 0);
    await page.getByLabel("Login destination").selectOption("my-domain");
    await page.getByLabel("Salesforce HTTPS address").fill("https://acme.my.salesforce.com");
    await capture("connect-org-dark");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  });
  await check("CLI status and installation detail use their own topic", async () => {
    await settings("cli");
    await page.getByRole("heading", { name: "Salesforce CLI is ready", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("heading", { name: "Org connections", exact: true }).count(),
      0,
    );
    await page.getByTestId("settings-disclosure-cli-installation-toggle").click();
    await page.getByText("/opt/homebrew/bin/sf", { exact: true }).waitFor();
    await capture("cli-ready-dark");
  });
  await check("all org Settings topics remain reachable", async () => {
    for (const id of ["overview", "limits", "metadata", "environments", "mods"]) {
      await settings(id);
      await page.locator('.os-settings[aria-busy="false"]').waitFor();
      assert.equal(await page.getByRole("alert").count(), 0);
    }
  });
  await check("documentation links return to scoped Settings topics", async () => {
    await settings("documentation");
    await page.getByRole("heading", { name: "Documentation", exact: true }).waitFor();
    await capture("documentation-dark");
    await page.getByRole("button", { name: "CLI setup", exact: true }).click();
    await page.getByRole("heading", { name: "Salesforce CLI is ready", exact: true }).waitFor();
  });
  await check("light mode persists through reload and styles the whole workspace", async () => {
    await settings("appearance");
    await page.getByTestId("appearance-light").click();
    assert.equal(await page.locator("html").evaluate((e) => e.classList.contains("dark")), false);
    assert.equal(
      await page.locator(".sf-app").evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgb(255, 255, 255)",
    );
    await capture("appearance-light");
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.getByTestId("appearance-light").getAttribute("aria-pressed"), "true");
    await page.getByTestId("settings-home").click();
    await page.getByTestId("admin-tool-query").click();
    await page.getByRole("textbox", { name: "SOQL query" }).waitFor();
    await capture("workspace-light");
  });
  await check("dark and system mode follow the shared appearance service", async () => {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await settings("appearance");
    await page.getByTestId("appearance-dark").click();
    assert.equal(
      await page.locator(".sf-app").evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgb(0, 0, 0)",
    );
    await capture("appearance-dark");
    await page.getByTestId("appearance-system").click();
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  });
  await check("narrow configuration navigation has no horizontal overflow", async () => {
    await page.setViewportSize({ width: 420, height: 900 });
    await page.getByRole("button", { name: "Toggle navigation", exact: true }).click();
    await settings("documentation");
    assert.equal(
      await page.locator(".sf-settings-page").evaluate((e) => e.scrollWidth <= e.clientWidth),
      true,
    );
    await capture("documentation-narrow");
    await page.setViewportSize({ width: 1280, height: 900 });
  });
  await check("missing CLI gates continuation and presents recoverable installation", async () => {
    await open("missing", "cli");
    assert.equal(await page.getByTestId("setup-choose-orgs").isDisabled(), true);
    await page.getByRole("heading", { name: "Install Salesforce CLI", exact: true }).waitFor();
    assert.match(
      await page.getByRole("link", { name: "Install from Salesforce" }).getAttribute("href"),
      /^https:\/\/developer.salesforce.com\//,
    );
    await capture("cli-missing-dark");
    await page.getByTestId("settings-disclosure-cli-help-toggle").click();
    await page.getByText("sf --version", { exact: true }).waitFor();
  });
  await check("outdated CLI keeps the minimum version visible", async () => {
    await open("unsupported", "cli");
    assert.equal(await page.getByTestId("setup-choose-orgs").isDisabled(), true);
    await page.getByRole("heading", { name: "Upgrade Salesforce CLI", exact: true }).waitFor();
    await capture("cli-upgrade-dark");
  });
  assert.deepEqual(errors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error);
  await capture("failure");
  throw error;
} finally {
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report));
}
