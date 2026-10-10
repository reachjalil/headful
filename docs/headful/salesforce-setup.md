# Salesforce setup

Headful is a harness for your org. It is independent and not affiliated with Salesforce. A large helmet marks startup and Welcome; the workspace keeps its compact 48px header. The first composed experience is Welcome → Salesforce CLI → Your orgs. Completed setup opens the selected org’s compact admin workspace: objects and fields, queries, record inspection, health and Setup shortcuts. Select an exact org/login beside the helmet, then choose a workspace tool from the sidebar or enter Settings. Returning to Workspace keeps that org’s query draft and results. Open Salesforce and Manage orgs are in the org selector; CLI readiness, Setup and connection refresh are in the sidebar footer.

Settings groups selected-org information separately from Connections and Local mods for this Mac. Choose a topic in the sidebar, or search settings to reach it directly. Entering Settings replaces the workspace sidebar with its topics and a Workspace back action. Breadcrumbs show the current topic and deeper license, usage or metadata selection; selecting a parent returns to the topic root. In a narrow window, open the navigation drawer. Each topic has one scrolling page. Connection state, capacity, expiry and warnings stay visible; expand named details for IDs, reporting information and help. Disclosure choices belong to the exact org and topic. Workspace and browser back/forward change direction, and reloading retains the selected Settings topic. During onboarding, the back action returns to the starting flow.

Appearance offers System, Light and Dark. The preference persists on this Mac and applies to initial loading, onboarding, workspace tools and Settings; System follows changes in your Mac’s appearance. Find it in Settings → Appearance or the CLI menu. Documentation is a short in-app setup guide with direct links to the relevant Settings topic and official Salesforce instructions.

Salesforce CLI owns authentication. Settings → Salesforce CLI separates installation from connection management. A ready CLI shows its version; executable paths and multiple-installation selection appear in Installation details. Missing or outdated CLI shows a three-step guide, while troubleshooting and alternative methods stay in a named disclosure. Install and upgrade links open Salesforce’s official instructions; Headful rechecks when the window regains focus or becomes visible, or when the user presses Recheck. Production, Developer Edition/sandbox, and scratch orgs are grouped. Each row identifies the exact CLI username and connection status. Org access is opt-in and enforced by the existing runtime. Reconnection opens Salesforce browser login; a different principal creates a separate connection so saved work keeps its original identity. Production sandbox inventory requires Salesforce API permissions. Matching a sandbox name to a CLI username is only a display hint.

## Understand your org before building

The app uses a compact editor frame with a top org bar, direct tool navigation, Workspace breadcrumbs and a slim connection status strip. Query data splits the window between an editor, scrolling results and a collapsible reference panel for fields, saved queries and history. The reference docks below results in narrow windows. The tool strip reads its labels and icons from installed mod declarations. Additional tools and contextual actions appear in the Tools menu; Manage local mods opens full-page Settings. Mod views open inside the editor and preserve the current org’s other drafts.

Choose the exact org and login from the dropdown in the top bar. It searches names, usernames, environments and org IDs; connections sharing an org remain separate logins. Available orgs switch directly. Other connections show why they need attention and open Connections without enabling access. Manage orgs is always available in the dropdown. The workspace and full-page Settings share this selection; switching preserves each org’s tool drafts. Local navigation history retains the selected connection across reload only while it remains available; it does not change the default org or saved operation targets. Overview identifies the environment, edition and instance. Licenses & usage opens a licensing view with separate user, feature (permission set) and managed-package inventories. Each license shows its reported status, assigned count, allowance, available count and expiry where supplied. The attention filter includes allocation at 80%, expiry within 30 days, inactive status and usage above allowance. Monthly login usage appears for login-based licenses only when UserLicense describe exposes both monthly fields. Each inventory can be unavailable independently; missing and negative allowances are shown as unknown rather than zero or an assumed unlimited entitlement. Counts are bounded to 500 records per inventory and never summed across overlapping license categories.

Switch to Org limits for API, storage, automation and development capacity, category filters, raw API-name search, units and reporting windows. These are snapshots of shared org capacity, not forecasts or per-user consumption. Availability does not establish assignability, billing, purchased products or a renewal date. Refresh performs another explicitly selected read; it does not poll or retry failed provider calls. The runtime uses fixed queries, validates the exact org and principal on every request, and retains CLI credentials on the Mac.

Metadata lets you find a type and inspect its components, package namespace and last modification. For folder-based metadata, supply the folder API name. A component’s “Use in your project” action provides a retrieval command pinned to the selected username; run it from your Salesforce DX project after reviewing local changes.

Environments shows CLI-reported scratch expiry even when current org details are unavailable. To inspect sandbox copies, select the parent production connection with permission to read SandboxInfo and SandboxProcess. Copy completion does not establish activation or distinguish creation from refresh. Refresh checks information again; it does not refresh a sandbox. Connections manages authentication and agent access through the same setup component.

## Release-owned CLI minimum

Set `HEADFUL_MINIMUM_SALESFORCE_CLI_VERSION` in `packages/contracts/src/headful-cli-policy.ts` for each desktop release. The current floor is `2.136.0`, which introduced the explicit access-token command needed by native REST requests. Standard `org display` output is metadata and may contain redacted credentials; the runtime uses `org auth show-access-token --json` internally and never requests refresh tokens or SFDX auth URLs. The native detector compares major/minor/patch numerically, accepts equal or newer stable versions, rejects legacy sfdx, malformed versions and prereleases, and returns the minimum in its typed result. The renderer displays that same value and blocks continuation below it. Native CLI operations fail closed when no supported executable is selected. Raising the floor needs the focused tests and any new command checks required by the release.

## Isolated development and screenshots

Start the existing web development server on a free local port:

```sh
PORT=5746 HOST=127.0.0.1 T3CODE_SINGLE_ORIGIN_DEV=1 pnpm --filter @t3tools/web dev
```

Open `http://127.0.0.1:5746/?experience=salesforce-setup&fixture=ready&step=welcome`. Fixtures: `ready`, `missing`, `unsupported`, `empty`, `expired`. Starting steps: `welcome`, `cli`, `orgs`, `workspace`. Reset / replay recreates the entire fixture state. All fixture records are fictional and labeled; these routes and fixture control are development-only and call no Salesforce service. Normal installed startup uses the authenticated native bridge.

```sh
pnpm headful:experience:test
HEADFUL_SETUP_URL=http://127.0.0.1:5746 HEADFUL_SETUP_EVIDENCE=/tmp/headful-salesforce-setup pnpm headful:setup:journey
HEADFUL_CONFIGURATION_EVIDENCE=/tmp/headful-org-configuration node scripts/headful-org-configuration-journey.mjs
```

The focused test command covers the release floor, focus-based recovery, persisted org opt-in, stale discovery, secret-safe subprocess output, verified principal identities, and a temporary runtime/CLI journey. Its provider responses are controlled test fixtures. The browser recipe uses the desktop’s existing `playwright-core` dependency and installed Chrome. It checks welcome, missing/outdated CLI, org toggles, sandbox inventory, add/reconnect, both Setup entry points, narrow layout, reset and typed development control. It saves PNGs and a JSON report, stops on the first failure, and never retries. Run against a local development preview; it does not sign in to production Salesforce or certify a packaged Mac build.

Native design recipes use `salesforce-setup` and the same named fixtures through the existing expiring control grant:

```js
await app.reset();
await app.mock({ fixture: "ready" });
await app.flow({ id: "salesforce-setup" });
await app.assert({ path: "step", equals: "welcome" });
await app.screenshot();
await app.click({ testId: "setup-start" });
await app.assert({ path: "step", equals: "cli" });
await app.click({ testId: "setup-choose-orgs" });
await app.assert({ path: "step", equals: "orgs" });
await app.screenshot();
```

The `initial` blank canvas remains an explicit development fixture. Fixture control never grants provider authority or human write approval. Screenshots from browser fixtures are UI evidence; native control, installed CLI login, packaging, signing and distribution require their own actual evidence.
