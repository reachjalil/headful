# Headful Extensions

Headful extensions are versioned npm packages with a declarative `headful.extension.json` manifest and a compiled activation module. The public host owns registration, compatibility, scoped settings, lifecycle, contributions, and Salesforce authority. Extensions can contribute features, routes, commands, Markdown surfaces, skills, MCP resources/transports, and supported harness integrations.

The design borrows declarative metadata and permissions from browser extensions, and in-process activation, commands, surfaces, and event hooks from [Claude Code Mods](https://code.claude.com/docs/en/plugins/mods/overview). It uses Headful's own typed API and manifest format.

## Local package registration

The checked-in [headful.extensions.json](../headful.extensions.json) lists trusted package registrations:

```json
{
  "schemaVersion": 1,
  "extensions": [{ "packageName": "@headfulcloud/mcp-apps" }]
}
```

For the current beta, `apps/server/package.json` uses `link:../../../headfulCloud/packages/mcp-apps`. Keep the private `headfulCloud` checkout next to this repository, build the package's compiled `dist`, and run `pnpm headful:setup`. The public app consumes compiled output through the npm package name. Nothing is published or downloaded from the `@headfulcloud` npm namespace by this workflow. A missing package produces an explicit bootstrap error.

```sh
pnpm --dir ../headfulCloud extensions:build
pnpm headful:setup
pnpm headful:dev
```

Adding another trusted extension requires its local dependency link and package registration, rather than modifying the Salesforce service or adding a special branch to the extension manager. The host resolves the package's `./manifest` export, validates its JSON identity, imports its default activation definition, and checks that both declare the same manifest. Duplicate package IDs, colliding transport/operation ownership, invalid namespaces, incompatible API versions, and missing dependencies fail closed.

A core-only build can use `"extensions": []` and omit the private dependency. It retains CLI onboarding, org management, the native workspace, and reviewed Salesforce workflows. The MCP Apps package is required for the default integrated beta build.

## Manifest and lifecycle

The authoritative schema and activation interfaces are in [headful-extensions.ts](../packages/contracts/src/headful-extensions.ts). A manifest declares:

- `schemaVersion`, `apiVersion`, `id`, `name`, `version`, `packageName`, and `license`.
- Required extensions and core features, a default enabled state, and typed settings with defaults.
- Explicit permissions for Salesforce reads/proposals, scoped local settings, harness files, MCP transport, and App resources.
- Namespaced features, routes, commands, surfaces, skills, harnesses, desktop operations, and lifecycle hooks.

The package exports a default `HeadfulExtensionDefinition` with `activate(context)`. Activation receives scoped settings, an abort signal, local resource paths, feature checks, and a restricted runtime port. It returns handlers and an awaited `dispose()` function. Commands and surfaces are dispatched only when declared, enabled, compatible, and available; their parameters and results are parsed against the public contracts. Surfaces return plain Markdown data rendered by the native app.

Enable/disable state and typed settings persist in the local owner-only SQLite store. Disabling immediately invalidates extension contexts, aborts their signals, disposes handlers, removes available feature contributions, and blocks new calls. Dependent extensions stop when a dependency becomes unavailable. Lifecycle errors are visible in the Extensions screen. Cleanup failure requires a restart before reactivation.

Removing a harness configuration and revoking existing grants remain available through explicitly declared recovery operations after the MCP extension is disabled. These operations cannot create a new client grant or configure a new connection.

## Authority and distribution

Extensions are trusted native code loaded from the application's build registration. They are not a sandbox for arbitrary third-party JavaScript. The beta has no marketplace downloader, arbitrary path loader, model-driven installation, or remote entitlement service. Manifest permission declarations constrain the host's supplied runtime port; code is still subject to normal Node and process trust.

The restricted port exposes bounded reads and draft/proposal operations. It cannot authorize orgs, create human reviews, approve proposals, or execute Salesforce writes. Client access still requires an explicit current org-scoped grant, and the core independently revalidates features, org authority, and workflow state. Native human review remains in the public Salesforce runtime.

`@headfulcloud/mcp-apps` is the first proprietary extension. Its private source, build scripts, tests, App wrappers, bridge, harness setup, and agent-plugin packaging belong in `headfulCloud/packages/mcp-apps`. The pure native workspace renderer and contracts remain public. The beta extension is included for use under its package license; npm publication remains a separate owner action.

The Mac packaging pipeline audits the linked distribution and snapshots only compiled `dist`, manifest, and license/notice files. It converts the development link into a staged local package, includes the physical stdio helper and self-contained App assets, and installs no private source checkout in the app. Bundled third-party code retains its licenses. There are no source maps in the proprietary distribution.
