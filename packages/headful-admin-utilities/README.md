# Headful Admin Utilities

This public MIT-licensed workspace package contributes real native utilities
through `headful.mod.json`: org navigation and setup shortcuts, read-only
record inspection, bounded SOQL with saved queries and CSV export, object and
field exploration, and supported read-only diagnostics.

Query data uses a code editor with line numbers, syntax colour, undo, find and
completion from available object names and explicitly loaded fields. Cmd/Ctrl
Enter runs the current draft through the read-only service. The divider above
results adjusts the editor height with dragging or arrow keys. Objects & fields
opens field details in place, including formula source when Salesforce returns
it. Documentation shows the same org's schema as Markdown source and a rendered
document. Formula source is read-only; Headful does not evaluate or apply it.

The public renderer components remain retained functionality. Normal startup mounts only the minimal workspace, Setup and settings. Enabling the mod authorizes declared utility services; it does not restore the superseded navigation or chat. The active org stays explicit and disabling the mod denies its utility capabilities.

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
proprietary mods. This slice does not claim full Salesforce Inspector,
ORGanizer or Salesforce DevTools parity.
