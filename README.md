# Headful

**Your local-first CRM agent orchestrator.** A free, open-source core, built first for Mac and Salesforce.

Headful puts your Salesforce orgs in the menu bar and gives you a shared, configurable workspace for org shortcuts, record inspection, read-only SOQL, object/field exploration, and diagnostics. Existing leads, users, access, permission sets, and reviewed changes use the same native workspace. The open-source utilities need no Headful account. An optional proprietary Extension adds local MCP Apps and supported agent harness setup.

Headful is a real fork of [T3 Code](https://github.com/pingdotgg/t3code), retaining its Electron application, local server, Effect services, persistence, chat/provider foundations, shared client architecture, and mobile source. Headful desktop packaging and distribution are **macOS only**. The optional private Connect Extension now supplies a controlled mobile development transport and hosted MCP gateway through the same authenticated local runtime. Native mobile distribution remains outside this milestone; upstream mobile source and shared client foundations stay intact.

## Early access

Join the [waitlist](https://headful.cloud/#waitlist). This is an early testing release; there is no public stable desktop download yet. Builds made from this source are unsigned and unnotarized unless you supply your own signing configuration. The checked initial artifact targets Apple Silicon.

[Salesforce CLI (`sf`)](https://developer.salesforce.com/tools/salesforcecli) is the only required external tool. Headful detects CLI installations and guides normal installation when missing. It imports only orgs you select, or starts the CLI's browser-based production, sandbox, or My Domain login. No connected-app client ID or secret is needed for the default desktop flow. Each sandbox requires its own authorization.

## Develop on Mac

Use Node 24.13.1+ (Node 26 is also used for the current build) and pnpm 11.10.0. A clean public clone installs and builds the open-source workspace and `@headfulcloud/admin-utilities`; it needs no private repository or npm credentials.

```sh
pnpm headful:setup
pnpm headful:dev
```

Mac packaging also compiles the retained native resource monitor. Install Rust with `rustup`; this repository pins the required 1.95.0 toolchain and its existing Cargo locks. The first native build downloads that toolchain as needed.

The command starts the upstream renderer, Electron application, tray, and its bundled local runtime. It uses `.headful-dev` in the checkout; packaged builds use `~/.headful`. They never use T3 Code's live application data.

```sh
pnpm headful:test       # focused local Salesforce, transport, and extension lifecycle tests
pnpm headful:check      # affected server, desktop, and web typechecks
pnpm headful:package    # Apple Silicon .app + ZIP in artifacts/headful
```

The installed app includes its runtime. Builds with the optional MCP Apps Extension also include a stdio MCP bridge. End users do not need Node or a source checkout. Close the workspace window to keep the menu bar and runtime running; use **Quit Headful** to stop them. A bridge requires the app to be running and exits cleanly if it is unavailable. It never launches another workflow executor.

Use the [Admin Utilities guide](docs/ADMIN_UTILITIES.md) for the shared header, org shortcuts, record inspection, query bounds, schema exports, and diagnostics. See [Extensions](docs/EXTENSIONS.md) to link the optional proprietary agent integration locally.

## Local authority and privacy

Your Salesforce credentials and CRM records are never routed through Headful's servers in local desktop mode. Salesforce CLI owns Salesforce authentication. All new utility operations run allowlisted `sf` commands through the trusted runtime with an explicit, freshly verified org target. Existing reviewed workflows retain their bounded direct Salesforce API implementation. The renderer, embedded Apps, diagnostic output, and MCP results do not receive Salesforce credentials. There is no mandatory account, telemetry, cloud sync, relay, or upstream updater.

Selected CRM results can be supplied to an external AI provider when you use that provider's harness. Salesforce receives Salesforce requests as normal. The website waitlist is a separate email collection service.

Client grants restrict orgs and operations and can be revoked. New imports are disabled for agent access until you enable them. Preparing a change never approves it. Consequential writes require the human's exact, expiring, single-use review in the desktop workspace. A changed org, target, revision, input or relevant provider state invalidates that approval. Unknown write outcomes require reconciliation; they are not automatically retried.

When the proprietary MCP Apps Extension is installed and enabled, use **Agent access** for supported local harness setup. A hosted ChatGPT connector cannot reach `127.0.0.1` on your Mac; use a compatible local host, or retain the separately authorized optional cloud offering. Internal T3 chat and provider sessions are experimental opt-in features, separate from Salesforce onboarding.

## Upstream and licenses

The current upstream base and version are recorded in [headful-upstream.json](headful-upstream.json). Follow [the reviewed upstream update process](docs/headful/upstream.md); `pnpm headful:upstream` detects changes and `pnpm headful:upstream prepare <ref>` prepares an integration branch. Neither merges nor publishes automatically. Headful release tags use `headful-v*`; preserved upstream release/mobile/relay jobs are guarded against running in this fork.

The public admin utility Extension is MIT licensed. Backups and restore are planned for a separate proprietary Extension and are outside this beta. T3 Code's MIT license and attribution are preserved. Original public Headful additions are MIT. The locally linked MCP Apps extension is proprietary compiled code, with its own license and third-party notices; its source belongs in the private Headful Cloud repository. Adapted Headful Cloud workspace and Salesforce workflow modules retain Apache-2.0; see LICENSES/Headful-Cloud-Apache-2.0.txt. Included third-party components retain their licenses. [Source adaptation and notices](docs/headful/architecture.md) distinguish public product code from private coordination. Vorssaint was a menu-bar UX reference only: no GPL source or assets were copied.

Headful Connect is an optional proprietary Extension and starts disabled. Local use requires no cloud identity. Explicit per-org remote opt-in and Mac-confirmed client grants govern remote reads and proposals; approval and provider writes remain on the Mac. Controlled clients exchange peer-authenticated encrypted application messages, while hosted MCP requests/results are processed by its separate gateway. Private implementation and development commands remain in the private companion repository; the public base works without those packages.
