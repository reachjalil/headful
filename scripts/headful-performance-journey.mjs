/** Production renderer + a synthetic bridge. No native runtime or provider is contacted. */
import * as NodeModule from "node:module";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeHttp from "node:http";
import * as NodeURL from "node:url";
import * as NodeAssert from "node:assert/strict";
import * as NodeZlib from "node:zlib";
const require = NodeModule.createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const preview = process.env.HEADFUL_URL ?? "http://127.0.0.1:5746";
if (!["127.0.0.1", "localhost"].includes(new URL(preview).hostname))
  throw Error("Use a local preview.");
const output = NodePath.resolve(
  process.env.HEADFUL_PERFORMANCE_EVIDENCE ?? "/tmp/headful-performance",
);
const dist = NodeURL.fileURLToPath(new URL("../apps/web/dist", import.meta.url));
await NodeFSP.mkdir(output, { recursive: true });
const manifest = JSON.parse(
  await NodeFSP.readFile(NodePath.join(dist, ".vite/manifest.json"), "utf8"),
);
const entry = Object.keys(manifest).find((key) => key.endsWith("headful/HeadfulShell.tsx"));
NodeAssert.ok(entry);
const seen = new Set();
function walk(key) {
  if (seen.has(key)) return;
  seen.add(key);
  for (const dependency of manifest[key].imports ?? []) walk(dependency);
}
walk(entry);
const chunks = await Promise.all(
  [...seen].sort().map(async (key) => {
    const source = await NodeFSP.readFile(NodePath.join(dist, manifest[key].file));
    return {
      key,
      file: manifest[key].file,
      bytes: source.length,
      gzipBytes: NodeZlib.gzipSync(source).length,
    };
  }),
);
const bundle = {
  entry,
  chunks,
  bytes: chunks.reduce((n, c) => n + c.bytes, 0),
  gzipBytes: chunks.reduce((n, c) => n + c.gzipBytes, 0),
};
await NodeFSP.writeFile(
  NodePath.join(output, "bundle-after.json"),
  JSON.stringify(bundle, null, 2) + "\n",
);
const fileFor = (suffix) => {
  const key = Object.keys(manifest).find((key) => key.endsWith(suffix));
  NodeAssert.ok(key, `Missing split surface ${suffix}`);
  return "/" + manifest[key].file;
};
const engine = fileFor("CodeEditorSurface.tsx"),
  document = fileFor("DocumentPreview.tsx"),
  query = fileFor("SoqlWorkspace.tsx");
for (const file of [engine, document, query])
  NodeAssert.equal(
    chunks.some((chunk) => "/" + chunk.file === file),
    false,
  );
const server = NodeHttp.createServer(async (request, response) => {
  try {
    const path = NodePath.resolve(dist, "." + new URL(request.url, "http://localhost").pathname);
    if (!path.startsWith(dist + "/") && path !== dist) {
      response.writeHead(403).end();
      return;
    }
    const file = path === dist ? NodePath.join(dist, "index.html") : path;
    const content = await NodeFSP.readFile(file);
    response.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : file.endsWith(".html")
            ? "text/html"
            : "application/octet-stream",
    );
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [],
  errors = [];
let failure;
try {
  // Get fictional service projections from the development fixture, never a live connection.
  const source = await browser.newPage();
  source.setDefaultTimeout(20000);
  await source.goto(`${preview}/?experience=initial&fixture=missing`, {
    waitUntil: "domcontentloaded",
  });
  await source.locator("[data-headful-canvas]").waitFor();
  const records = await source.evaluate(async () => {
    const { createAdminFixture } = await import("/src/headful/admin-workspace/fixtures.ts");
    const fixture = createAdminFixture("ready");
    const { orgs } = await fixture("orgs.list", {});
    const orgId = orgs[0].id;
    const result = {};
    for (const [operation, input] of [
      ["features.list", {}],
      ["mods.list", {}],
      ["cli.detect", {}],
      ["orgs.list", {}],
      ["orgs.discover", {}],
      ["utilities.objects.list", { orgId, category: "all" }],
      ["utilities.objects.describe", { orgId, object: "Account" }],
      ["utilities.saved.list", { orgId }],
      ["utilities.history.list", { orgId }],
      [
        "utilities.query.run",
        {
          orgId,
          query: "SELECT Id, Name FROM Account LIMIT 50",
          pageSize: 50,
          requestId: "fixture_performance_query",
        },
      ],
      ["utilities.favorites.list", { orgId }],
    ])
      result[operation] = await fixture(operation, input);
    result["features.list"].onboardingComplete = true;
    return result;
  });
  await source.close();
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  const loaded = new Set();
  page.on("request", (request) => loaded.add(new URL(request.url()).pathname));
  await page.addInitScript((records) => {
    window.desktopBridge = {};
    window.__performanceCalls = [];
    window.headfulBridge = {
      dispatch: async (operation, input) => {
        window.__performanceCalls.push({ operation, input });
        if (!Object.hasOwn(records, operation))
          throw Error(`Unplanned synthetic operation: ${operation}`);
        const result = structuredClone(records[operation]);
        if (operation === "utilities.query.run") {
          result.requestId = input.requestId;
          result.query = input.query;
        }
        return result;
      },
    };
    addEventListener("DOMContentLoaded", () => {
      const banner = document.createElement("div");
      banner.textContent =
        "PERFORMANCE FIXTURE · FICTIONAL RECORDS · SYNTHETIC BRIDGE · NO NATIVE OR SALESFORCE CALLS";
      banner.style.cssText =
        "position:fixed;bottom:0;left:0;right:0;z-index:10000;background:#edf2dc;padding:4px;font:10px monospace;text-align:center";
      document.body.append(banner);
    });
  }, records);
  const count = (operation) =>
    page.evaluate(
      (op) => window.__performanceCalls.filter((call) => call.operation === op).length,
      operation,
    );
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-object-account").waitFor();
  NodeAssert.equal(await count("features.list"), 1);
  NodeAssert.equal(await count("utilities.objects.list"), 1);
  for (const file of [engine, document, query]) NodeAssert.equal(loaded.has(file), false);
  checks.push(
    "Production startup loads the schema task without query, code engine or Markdown/math chunks; features read once.",
  );
  await page.getByTestId("admin-object-account").click();
  await page.getByTestId("admin-schema-documentation").waitFor();
  await page.getByTestId("admin-tool-query").click();
  await page.getByTestId("admin-query-editor").waitFor();
  NodeAssert.equal(loaded.has(engine), true);
  NodeAssert.equal(loaded.has(query), true);
  NodeAssert.equal(loaded.has(document), false);
  await page.getByRole("button", { name: "Read fields", exact: true }).click();
  await page.getByRole("button", { name: "Name (Name), string", exact: true }).waitFor();
  NodeAssert.equal(await count("utilities.objects.list"), 1);
  NodeAssert.equal(await count("utilities.objects.describe"), 1);
  checks.push(
    "Query loads code on demand and reuses the schema's exact org/object metadata without another provider projection.",
  );
  await page.getByTestId("admin-query-editor").fill("SELECT Id, Name FROM Account LIMIT 25");
  await page.getByTestId("admin-run-query").click();
  await page.getByRole("heading", { name: "Query results", exact: true }).waitFor();
  await page.getByTestId("admin-run-query").click();
  await page.waitForFunction(
    () =>
      window.__performanceCalls.filter((call) => call.operation === "utilities.query.run")
        .length === 2,
  );
  checks.push(
    "Identical explicit query runs dispatch twice; execution is never served from metadata cache.",
  );
  await page.getByTestId("admin-tool-schema").click();
  await page.getByTestId("admin-schema-documentation").click();
  await page
    .getByRole("article", { name: "Account field documentation", exact: true })
    .locator("tbody tr")
    .first()
    .waitFor();
  NodeAssert.equal(loaded.has(document), true);
  await page.getByTestId("admin-schema-document-split").click();
  await page.getByTestId("admin-schema-document-source-editor").waitFor();
  await page.screenshot({ path: NodePath.join(output, "production-document.png") });
  await page.getByTestId("admin-tool-query").click();
  NodeAssert.equal(
    await page.getByTestId("admin-query-editor").innerText(),
    "SELECT Id, Name FROM Account LIMIT 25",
  );
  NodeAssert.equal(await count("utilities.objects.list"), 1);
  checks.push(
    "Document/math loads at document intent; split source and tool switching preserve the org query draft.",
  );
  NodeAssert.deepEqual(errors, []);
  await NodeFSP.writeFile(
    NodePath.join(output, "calls.json"),
    JSON.stringify(await page.evaluate(() => window.__performanceCalls), null, 2) + "\n",
  );
  checks.push(
    "No production browser exceptions; all runtime projections were explicitly synthetic.",
  );
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
const report = {
  status: failure ? "failed" : "passed",
  checks,
  errors,
  failure: failure ?? null,
  bundle,
  limits:
    "Production assets in Chrome with a synthetic bridge. Not native/live Salesforce evidence or a latency benchmark.",
};
await NodeFSP.writeFile(
  NodePath.join(output, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    status: report.status,
    checks: checks.length,
    bytes: bundle.bytes,
    gzipBytes: bundle.gzipBytes,
    failure,
    output,
  }),
);
if (failure) process.exitCode = 1;
