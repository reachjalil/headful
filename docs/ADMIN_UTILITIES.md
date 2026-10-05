# Admin Utilities beta

Use Admin Utilities to inspect records, run read-only queries, explore fields, check org health and open Salesforce Setup shortcuts. The extension is included in Headful and available from the sidebar when enabled. Salesforce permissions still apply; these tools cannot change records or approve writes.

## Start with an explicit org

In **Your orgs**, choose **Connect an org** to sign in through Salesforce, or **Import from CLI** to add an existing login. If Salesforce CLI is missing, install it and choose **Recheck CLI** first. Agent access starts off. Only orgs added to Headful appear in the workspace selector; each sandbox needs its own login.

Open an org’s workspace or an Admin Utility from the sidebar. The header shows the target org, environment, verified Salesforce org ID and connected user or alias. Labels and colors help recognition; they do not change the connection’s Salesforce identity.

The shared header always shows the target org. Choose another org explicitly or use **Workspace commands** (`⌘⇧K`). Switching a workspace target does not change Headful's default org. Existing reviewed workflows and permission proposals remain pinned to their saved org; open a new workspace to use another target.

## Find tools and resume work

Use **Search** in the sidebar title bar (`⌘K`) to find app pages, connected orgs, available admin utilities, installed Extensions and saved user workflows. Arrow keys select a result; Enter opens it; Escape closes search and returns focus. Choosing an org opens an explicit workspace without changing the default. Saved workflows and proposals keep their original org.

Open the adjacent notification bell for CLI or connection issues, enabled Extension outages, user workflows ready to review and recent permission-change updates. Opening an item marks it read and opens its saved context. A permission update is recent history: open its proposal to check the current status and expiry. **Mark all read**, individual dismissal and **Dismiss read notifications** affect only the inbox, not the saved work.

Read and dismissed IDs stay on this Mac; CRM contents and credentials are not copied into inbox preferences. Updates refresh every 30 seconds while the app is visible, on focus and on manual refresh. If refreshing fails, previously loaded updates remain visible with an error.

## Customize the workspace header

Open **Customize workspace** to hide or reorder optional controls. Save a global default or an override for the current workspace. **Reset global defaults** restores the contributed defaults; **Use global defaults** removes a workspace override. The target selector cannot be hidden. Preferences remain in the local owner-only store.

Enabled Extensions contribute available navigation, panels, commands, actions, and settings. Disable **Admin Utilities** in **Extensions** to remove its contributions and block its service operations. The core connection flows and reviewed workspace remain available. The `compact-results` setting changes utility table density.

## Everyday utilities

- **Org shortcuts** opens the selected org or supported Salesforce Setup destinations. Favorites stay with that org. These are fixed destinations, not arbitrary URLs or CLI commands.
- **Record inspector** reads a record by object API name and Salesforce ID. The core Leads search/detail view also offers **Inspect all readable fields** while this Extension is active. Filter field labels, API names, types, and values; copy individual values, the ID, or structured JSON; open the same record in its original org. Salesforce field permissions still apply.
- **SOQL workspace** runs one read-only `SELECT` query. Object and field suggestions come from CLI schema reads. Queries and history are saved per org; history records query text and execution metadata, without retaining result datasets. Results load in pages of at most 500 rows, with a one-row look-ahead and a 2,000-row offset bound. **Cancel query** terminates the owned CLI child. **Export this page CSV** exports only loaded rows and does not fetch additional pages.
- **Object & field explorer** browses object API names and describes accessible fields, types, picklists, and relationships. Search field labels/API names, select fields, then choose **Open query for selected fields** to open the SOQL editor. The query runs only when you choose **Run query**. You can also export local schema documentation. The explorer creates or deletes no schema.
- **Org diagnostics** reads supported limits and storage, recent Apex jobs, and available debug logs. Missing CLI capabilities and Salesforce permissions produce useful unavailable states. It performs no job execution or log configuration.

Copied values and exported files are local CRM data. You decide where to share them. Using an external agent provider separately can send selected CRM context to that provider.

## CLI and authority boundary

The command families were checked against Salesforce CLI **2.86.9**: `data query`, `data get record`, `sobject list`, `sobject describe`, `org list limits`, `apex list log`, `apex get log`, and `org open`. The fixed identity check uses CLI-owned `org display` and `api request rest /services/oauth2/userinfo --method GET`; that installed API command prints JSON directly and does not support a `--json` flag.

The runtime validates explicit target usernames, authenticated org/principal/origin, inputs, JSON output shapes, execution time and output size. It executes argument arrays without a shell. Extension permissions grant narrow reads, never an unrestricted CLI capability, Apex execution, credentials, or write approval. Disabled services reject late results; disabling query access aborts active reads. There is no credential-based REST fallback for these utilities.

Users & Access and Permission Sets retain their existing exact human review, expiring single-use approvals, stale-state validation, provider receipts, and unknown-outcome reconciliation. Utility reads cannot bypass those safeguards.

## Scope and distribution

A clean public clone runs `pnpm headful:setup`, `pnpm headful:dev`, and `pnpm headful:package` without a private repository or npm credentials. The proprietary `@headfulcloud/mcp-apps` integration is a separately linked optional compiled package; see [Extensions](EXTENSIONS.md).

This is a Mac beta, initially packaged on Apple Silicon. Mobile source and shared T3 client architecture are preserved; mobile development and distribution are outside this slice. Backups and restore are planned for a separate proprietary Extension. Scheduled snapshots, sandbox seeding, metadata deployment/comparison, bulk imports, and advanced automation are also outside this beta. The utilities do not claim full Salesforce Inspector, ORGanizer, or DevTools parity.
