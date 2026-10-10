/** Focused, stop-on-first-failure UI recipe. No real Salesforce login or provider writes. */
import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeAssert from "node:assert/strict";
import { HEADFUL_MINIMUM_SALESFORCE_CLI_VERSION } from "../packages/contracts/src/headful-cli-policy.ts";
const require = NodeModule.createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const base = process.env.HEADFUL_SETUP_URL ?? "http://127.0.0.1:5746";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw new Error("Use a local Headful development preview.");
const output = NodePath.resolve(
  process.env.HEADFUL_SETUP_EVIDENCE ?? "/tmp/headful-salesforce-setup",
);
await NodeFSP.mkdir(output, { recursive: true });
const sources = [
  "apps/web/src/headful/HeadfulShell.tsx",
  "apps/web/src/headful/SalesforceSetup.tsx",
  "apps/web/src/headful/OrgSwitcher.tsx",
  "apps/web/src/headful/org-settings/OrgSettings.tsx",
  "apps/web/src/headful/org-settings/org-settings.css",
  "apps/web/src/headful/SetupPreview.tsx",
  "apps/web/src/headful/setup-service.ts",
  "apps/web/src/headful/experience-control.ts",
  "apps/web/src/headful/experience-views.ts",
  "packages/contracts/src/headful-experiences.ts",
  "apps/web/src/main.tsx",
  "packages/contracts/src/headful.ts",
  "apps/web/src/headful/setup-fixtures.ts",
  "apps/web/src/headful/salesforce-setup.css",
  "apps/server/src/headful/SalesforceCli.ts",
  "apps/server/src/headful/OrgService.ts",
  "packages/contracts/src/headful-cli-policy.ts",
  "scripts/headful-setup-journey.mjs",
];
const hash = NodeCrypto.createHash("sha256");
for (const path of sources)
  hash.update(path).update(await NodeFSP.readFile(new URL(`../${path}`, import.meta.url)));
const sourceDigest = hash.digest("hex");
const started = performance.now();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const steps = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1080 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function open(fixture, step) {
    await page.goto(`${base}/?experience=salesforce-setup&fixture=${fixture}&step=${step}`, {
      waitUntil: "networkidle",
    });
    await page.locator('[data-headful-setup][aria-busy="false"]').waitFor();
    NodeAssert.equal(await page.getByRole("alert").count(), 0);
  }
  const capture = async (name) => {
    await page.screenshot({ path: NodePath.resolve(output, `${name}.png`) });
    steps.push(name);
  };
  let resumeBootstrap;
  const bootGate = new Promise((resolve) => {
    resumeBootstrap = resolve;
  });
  await page.route("**/src/bootstrap.ts", async (route) => {
    await bootGate;
    await route.continue();
  });
  await page.goto(`${base}/?experience=salesforce-setup&fixture=ready&step=welcome`, {
    waitUntil: "commit",
  });
  await page.locator("#boot-shell-helmet").waitFor();
  NodeAssert.equal(
    await page
      .locator("#boot-shell-helmet")
      .evaluate((image) => image.getBoundingClientRect().width),
    144,
  );
  await capture("startup");
  resumeBootstrap();
  await page.unroute("**/src/bootstrap.ts");
  await open("ready", "welcome");
  await page.getByRole("heading", { name: "Welcome to Headful" }).waitFor();
  await page.getByText("A HARNESS FOR YOUR ORG", { exact: true }).waitFor();
  await page
    .getByText("Headful is independent and is not affiliated with Salesforce.", { exact: true })
    .waitFor();
  NodeAssert.equal(
    await page
      .locator(".sf-onboarding > .sf-brand img")
      .evaluate((image) => image.getBoundingClientRect().width),
    64,
  );
  await capture("welcome");
  await page.getByTestId("setup-start").click();
  await page.getByRole("heading", { name: "Salesforce CLI is ready" }).waitFor();
  await capture("cli-ready");
  await page.getByTestId("setup-choose-orgs").click();
  await page.getByRole("switch", { name: "Enable Release Scratch" }).waitFor();
  NodeAssert.equal(
    await page
      .getByRole("switch", { name: "Enable Acme Development" })
      .getAttribute("aria-checked"),
    "false",
  );
  await capture("orgs");
  await page.getByRole("switch", { name: "Enable Acme Development" }).click();
  await page.locator('[data-headful-setup][aria-busy="false"]').waitFor();
  NodeAssert.equal(
    await page
      .getByRole("switch", { name: "Enable Acme Development" })
      .getAttribute("aria-checked"),
    "true",
  );
  await page.getByLabel("Connection options for Acme Production").click();
  await page.getByRole("button", { name: "Find sandboxes" }).click();
  await page.getByRole("heading", { name: "Sandboxes of Acme Production" }).waitFor();
  await capture("sandboxes");
  await page.getByRole("button", { name: "Close sandbox list" }).click();
  await page.getByTestId("setup-finish").click();
  await page.getByRole("navigation", { name: "Admin tools", exact: true }).waitFor();
  await capture("workspace");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("settings-page").waitFor();
  await capture("settings");
  await page.getByTestId("settings-home").click();
  NodeAssert.equal(await page.getByTestId("settings-page").count(), 0);
  await page.locator(".sf-header-menu summary").click();
  await page.getByRole("button", { name: "Setup", exact: true }).click();
  await page.getByTestId("settings-page").waitFor();
  await page.getByTestId("settings-home").click();
  NodeAssert.equal(await page.locator(".sf-header-menu").getAttribute("open"), null);
  NodeAssert.equal(
    await page
      .locator(".sf-header-menu summary")
      .evaluate((control) => document.activeElement === control),
    true,
  );
  steps.push("both-setup-entry-points");
  await open("missing", "cli");
  await page.getByRole("heading", { name: "Install Salesforce CLI" }).waitFor();
  NodeAssert.match(
    await page.getByRole("link", { name: "Install from Salesforce" }).getAttribute("href"),
    /^https:\/\/developer.salesforce.com\//,
  );
  NodeAssert.equal(await page.getByTestId("setup-choose-orgs").isDisabled(), true);
  await capture("cli-missing");
  await open("unsupported", "cli");
  await page.getByRole("heading", { name: "Upgrade Salesforce CLI" }).waitFor();
  NodeAssert.ok(
    (await page.locator(".sf-cli-card").innerText()).includes(
      HEADFUL_MINIMUM_SALESFORCE_CLI_VERSION,
    ),
  );
  NodeAssert.equal(await page.getByTestId("setup-choose-orgs").isDisabled(), true);
  await capture("cli-upgrade");
  await open("empty", "orgs");
  await page.getByRole("heading", { name: "No Salesforce orgs yet" }).waitFor();
  await capture("empty-orgs");
  await page.getByRole("button", { name: "Add org", exact: true }).click();
  await page.getByRole("button", { name: "Continue to Salesforce" }).click();
  await page.getByRole("switch").waitFor();
  steps.push("add-org-fixture");
  await open("expired", "orgs");
  NodeAssert.equal(
    await page.getByRole("switch", { name: "Enable Acme Development" }).isDisabled(),
    true,
  );
  await capture("reconnect-required");
  await page.getByLabel("Connection options for Acme Development").click();
  await page.getByRole("button", { name: "Reconnect as another user" }).click();
  await page.locator('[data-headful-setup][aria-busy="false"]').waitFor();
  NodeAssert.equal(
    await page.getByRole("switch", { name: "Enable Acme Development" }).isDisabled(),
    false,
  );
  steps.push("reconnect-fixture");
  await page.locator(".sf-row-menu[open] summary").click();
  await page.setViewportSize({ width: 420, height: 980 });
  await capture("orgs-narrow");
  NodeAssert.equal(
    await page.locator(".sf-app").evaluate((element) => element.scrollWidth > element.clientWidth),
    false,
  );
  await page.getByRole("button", { name: "Reset / replay" }).click();
  await page.locator('[data-headful-setup][aria-busy="false"]').waitFor();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Enable Acme Development"]')?.disabled === true,
  );
  steps.push("reset-replay");
  await page.evaluate(async () => {
    const control = window.__headfulExperienceControl;
    await control("reset", {});
    await control("mock", { fixture: "ready" });
    await control("flow", { id: "salesforce-setup" });
    await control("click", { testId: "setup-start" });
    await control("assert", { path: "step", equals: "cli" });
    await control("click", { testId: "setup-choose-orgs" });
    await control("assert", { path: "step", equals: "orgs" });
  });
  steps.push("typed-mcp-fixture-recipe");
  NodeAssert.deepEqual(errors, []);
  const report = {
    status: "passed",
    kind: "fictional development UI journey",
    revision: process.env.HEADFUL_SETUP_REVISION ?? sourceDigest,
    sources,
    durationMs: Math.round(performance.now() - started),
    steps,
    screenshotDirectory: output,
    serviceBoundary:
      "Run headful:experience:test separately for runtime and CLI checks. No live Salesforce login performed.",
  };
  await NodeFSP.writeFile(
    NodePath.resolve(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
