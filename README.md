# Headful

**Your local-first CRM agent orchestrator.** A free, open-source core, built first for Mac and Salesforce.

Headful puts your Salesforce orgs in the menu bar and gives you a focused workspace for leads, users, access, permission sets, and reviewed changes. Use its local MCP tools in your preferred supported desktop or CLI agent harness. Core desktop mode needs no Headful account.

Headful is a real fork of [T3 Code](https://github.com/pingdotgg/t3code), retaining its Electron application, local server, Effect services, persistence, chat/provider foundations, shared client architecture, and mobile source. Initial Headful development, packaging, and distribution are **macOS only**. The mobile companion remains outside this release; Salesforce services are portable contracts over an authenticated local runtime, ready for a separately reviewed secure companion transport later.

## Early access

Join the [waitlist](https://headful.cloud/#waitlist). This is an early testing release; there is no public stable desktop download yet. Builds made from this source are unsigned and unnotarized unless you supply your own signing configuration. The checked initial artifact targets Apple Silicon.

[Salesforce CLI (`sf`)](https://developer.salesforce.com/tools/salesforcecli) is the only required external tool. Headful detects CLI installations and guides normal installation when missing. It imports only orgs you select, or starts the CLI's browser-based production, sandbox, or My Domain login. No connected-app client ID or secret is needed for the default desktop flow. Each sandbox requires its own authorization.

## Develop on Mac

Use Node 24.13.1+ (Node 26 is also used for the current build) and pnpm 11.10.0. The default development build locally links the private `@headfulcloud/mcp-apps` extension from the adjacent `../headfulCloud/packages/mcp-apps` folder. Build that package first with `pnpm --dir ../headfulCloud extensions:build`. No package is fetched from npm. See [Extensions](docs/EXTENSIONS.md) for the package boundary and core-only registration.

```sh
pnpm headful:setup
pnpm headful:dev
```

The command starts the upstream renderer, Electron application, tray, and its bundled local runtime. It uses `.headful-dev` in the checkout; packaged builds use `~/.headful`. They never use T3 Code's live application data.

```sh
pnpm headful:test       # focused local Salesforce, transport, and extension lifecycle tests
pnpm headful:check      # affected server, desktop, and web typechecks
pnpm headful:package    # Apple Silicon .app + ZIP in artifacts/headful
```

The installed app includes its runtime and stdio MCP bridge. End users do not need Node or a source checkout. Close the workspace window to keep the menu bar and runtime running; use **Quit Headful** to stop them. A bridge requires the app to be running and exits cleanly if it is unavailable. It never launches another workflow executor.

## Local authority and privacy

Your Salesforce credentials and CRM records are never routed through Headful's servers in local desktop mode. Salesforce CLI owns Salesforce authentication; the local runtime obtains short-lived access for direct Salesforce requests. The renderer, embedded Apps, diagnostic output, and MCP results do not receive Salesforce credentials. There is no mandatory account, telemetry, cloud sync, relay, or upstream updater.

Selected CRM results can be supplied to an external AI provider when you use that provider's harness. Salesforce receives Salesforce requests as normal. The website waitlist is a separate email collection service.

Client grants restrict orgs and operations and can be revoked. New imports are disabled for agent access until you enable them. Preparing a change never approves it. Consequential writes require the human's exact, expiring, single-use review in the desktop workspace. A changed org, target, revision, input or relevant provider state invalidates that approval. Unknown write outcomes require reconciliation; they are not automatically retried.

Use **Agent access** for supported local harness setup. A hosted ChatGPT connector cannot reach `127.0.0.1` on your Mac; use a compatible local host, or retain the separately authorized optional cloud offering. Internal T3 chat and provider sessions are experimental opt-in features, separate from Salesforce onboarding.

## Upstream and licenses

The current upstream base and version are recorded in [headful-upstream.json](headful-upstream.json). Follow [the reviewed upstream update process](docs/headful/upstream.md); `pnpm headful:upstream` detects changes and `pnpm headful:upstream prepare <ref>` prepares an integration branch. Neither merges nor publishes automatically. Headful release tags use `headful-v*`; preserved upstream release/mobile/relay jobs are guarded against running in this fork.

T3 Code's MIT license and attribution are preserved. Original public Headful additions are MIT. The locally linked MCP Apps extension is proprietary compiled code, with its own license and third-party notices; its source belongs in the private Headful Cloud repository. Adapted Headful Cloud workspace and Salesforce workflow modules retain Apache-2.0; see LICENSES/Headful-Cloud-Apache-2.0.txt. Included third-party components retain their licenses. [Source adaptation and notices](docs/headful/architecture.md) distinguish public product code from private coordination. Vorssaint was a menu-bar UX reference only: no GPL source or assets were copied.
