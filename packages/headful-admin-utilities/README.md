# Headful Admin Utilities

This public MIT-licensed workspace package contributes real native utilities
through `headful.extension.json`: org navigation and setup shortcuts, read-only
record inspection, bounded SOQL with saved queries and CSV export, object and
field exploration, and supported read-only diagnostics.

The shared Headful shell resolves the declared navigation, header controls,
panels and actions against the public registered React components. The active
org remains explicit. Global header preferences and workspace overrides persist
through the typed local runtime. Disabling this extension removes its active
contributions and denies its utility service capabilities.

The compiled default server export supplies command activation and lifecycle.
`./web` exports the public frontend registry for the browser build. Development
uses a `workspace:*` dependency; no private checkout, npm login or cloud account
is required. `pnpm build` produces a self-contained server module and notices
for Mac staging. No package publication occurs during setup or packaging.

All provider work goes through the existing trusted Salesforce CLI broker using
validated arguments and an explicit verified target. This package receives no
credentials, raw CLI runner, Salesforce write or human approval capability.
Permissions and capabilities are declared narrowly in the manifest and checked
at the runtime boundary. Backups, restore and broader automation remain future
proprietary extensions. This slice does not claim full Salesforce Inspector,
ORGanizer or Salesforce DevTools parity.
