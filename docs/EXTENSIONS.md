# Headful Extensions

Headful extensions are versioned npm packages with a declarative `headful.extension.json` manifest and a compiled activation module. The public host owns registration, compatibility, scoped settings, lifecycle, contributions, and Salesforce authority. Extensions can contribute features, routes, commands with declared forms, Markdown surfaces, skills, MCP resources/transports, supported harness integrations, native menu items, bounded statuses, typed host events and restricted capability registrations.

The design borrows declarative metadata and permissions from browser extensions, and in-process activation, commands, surfaces, and event hooks from [Claude Code Mods](https://code.claude.com/docs/en/plugins/mods/overview). It uses Headful's own typed API and manifest format.

## Local package registration

The checked-in [headful.extensions.json](../headful.extensions.json) lists trusted package registrations:

```json
{
  "schemaVersion": 1,
  "extensions": [
    { "packageName": "@headfulcloud/admin-utilities" },
    { "packageName": "@headfulcloud/mcp-apps", "optional": true },
    { "packageName": "@headfulcloud/connect-desktop", "optional": true }
  ]
}
```

The open-source admin utilities are a normal local workspace package. `pnpm headful:setup` installs the Mac dependencies and compiles their server activation module. A clean public clone can develop and package Headful without a private checkout, registry credentials, or changes to its registration manifest.

The proprietary MCP Apps and Connect integrations are optional and linked only in the owner's development environment. Its implementation remains in the adjacent private repository. Build it and explicitly link the compiled package after public setup:

```sh
pnpm headful:setup
pnpm --dir ../headfulCloud extensions:build
pnpm --dir ../headfulCloud extensions:link
pnpm headful:dev
```

Nothing is published or downloaded from the `@headfulcloud` npm namespace. The developer linking command accepts only optional packages already named in the checked-in registry, checks their compiled entry and manifest, and refuses to replace a different installed package. Re-run the local link command after an install if the package manager removes the optional link. `pnpm headful:extensions unlink ../headfulCloud/packages/mcp-apps` removes that exact development link.

The host resolves package metadata and its `./manifest` export before importing its compiled default activation definition. A missing optional package is skipped. A missing required package, an installed package with an invalid manifest, duplicate identity, colliding operation ownership, or an invalid namespace fails closed. Compatibility and activation failures are reported by the Extensions manager.

Adding another trusted Extension requires its package registration, typed manifest, and a compiled activation definition. This does not add a special Salesforce service branch to the manager. Renderer components register against namespaced component IDs; manifests contribute navigation, panels, header controls, actions, and commands that resolve through those IDs. The shared shell owns the DOM and workspace layout.

The public utility Extension supplies org shortcuts, record inspection, SOQL, schema exploration, and read-only diagnostics. Its server definition and frontend components live in `packages/headful-admin-utilities`; the core CLI broker retains Salesforce authority. The default native workspace and connection flows stay usable when either Extension is disabled or the proprietary package is absent.

## Manifest and lifecycle

The authoritative schema and activation interfaces are in [headful-extensions.ts](../packages/contracts/src/headful-extensions.ts). A manifest declares:

- `schemaVersion`, `apiVersion`, `id`, `name`, `version`, `packageName`, and `license`.
- Explicit server, Electron-main, renderer, mobile and Worker entry contexts. The local loader imports only the declared compiled server entry; other clients bundle their own compatible context.
- Required extensions and core features, a default enabled state, and typed settings with defaults.
- Explicit permissions for Salesforce reads/proposals, scoped local settings, harness files, MCP transport, App resources and remote transport.
- Namespaced features, routes, commands, surfaces, skills, harnesses, desktop operations, and lifecycle hooks.

The package exports a default `HeadfulExtensionDefinition` with `activate(context)`. Activation receives scoped settings, an abort signal, local resource paths, host-resolved compiled peer entries, feature checks, a restricted runtime port, status publication, declared host-event subscriptions and capability registration. It returns handlers and an awaited `dispose()` function. Commands and surfaces are dispatched only when declared, enabled, compatible, and available; their parameters and results are parsed against the public contracts. Surfaces return plain Markdown data rendered by the native app. Commands expose typed scalar inputs; declared secret fields use one-use password controls and are not persisted as preferences. Native menu and route contributions resolve through the same manager. Status, listeners and registered capabilities disappear when their activation context stops.

Enable/disable state and typed settings persist in the local owner-only SQLite store. Disabling immediately invalidates extension contexts, aborts their signals, disposes handlers, removes available feature contributions, and blocks new calls. Dependent extensions stop when a dependency becomes unavailable. Lifecycle errors are visible in the Extensions screen. Cleanup failure requires a restart before reactivation.

Removing a harness configuration and revoking existing grants remain available through explicitly declared recovery operations after the MCP extension is disabled. These operations cannot create a new client grant or configure a new connection.

## Authority and distribution

Extensions are trusted native code loaded from the application's build registration. They are not a sandbox for arbitrary third-party JavaScript. The beta has no marketplace downloader, arbitrary path loader, model-driven installation, or remote entitlement service. Manifest permission declarations constrain the host's supplied runtime port; code is still subject to normal Node and process trust.

The restricted port exposes bounded reads and draft/proposal operations, plus declared narrow CLI utility capabilities for querying, inspection, schema, limits, jobs, logs, and org shortcuts. It has no general command execution capability. It cannot authorize orgs, create human reviews, approve proposals, or execute Salesforce writes. Client access still requires an explicit current org-scoped grant, and the core independently revalidates features, org authority, and workflow state. Native human review remains in the public Salesforce runtime.

`@headfulcloud/mcp-apps` and `@headfulcloud/connect-desktop` are optional proprietary extensions. Its private source, build scripts, tests, App wrappers, bridge, harness setup, and agent-plugin packaging belong in `headfulCloud/packages/mcp-apps`. The pure native workspace renderer and contracts remain public. The beta extensions are included for use under its package license; npm publication remains a separate owner action.

The Mac packaging pipeline audits every installed registered distribution and snapshots only compiled `dist`, manifest, and license/notice files. Public utility frontend source is bundled into the web renderer; the installed server package contains compiled code. Missing optional modules add no resources or dependencies. It converts the development link into a staged local package, includes the physical stdio helper and self-contained App assets, and installs no private source checkout in the app. Bundled third-party code retains its licenses. There are no source maps in the proprietary distribution.

## Planned proprietary capabilities

Backups, restore, scheduled snapshots, sandbox seeding, metadata comparison/deployment, bulk imports, and advanced automation are outside this utility beta. Backup and restore implementation belongs in a future separate proprietary `@headfulcloud/*` Extension, never in public utility source or history.

Headful Connect is disabled by default. Its non-human remote authority requires current remote per-org opt-in independently from local MCP grants, and cannot issue a human review or apply a Salesforce write. The private relay, encrypted controlled client and hosted gateway use the same local domain runtime. Local use requires no Connect identity or cloud service. Package authenticity and license are independent from any future entitlement and from Salesforce grants/approvals.
