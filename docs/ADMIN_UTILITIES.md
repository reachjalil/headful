# Admin Utilities beta

`@headfulcloud/admin-utilities` is an MIT-licensed public Extension included in a normal Headful build. It contributes five workspaces, commands, header controls and actions through `headful.extension.json`. It uses the public Salesforce runtime; no separate Salesforce business logic or authentication store lives in the renderer.

## Start with an explicit org

Connect an org or select an existing connection in **Your orgs**. Only imported connections appear in the workspace selector. Each connection displays its verified Salesforce org and principal, environment, alias, status, and cloud color. A sandbox needs its own CLI authorization.

The shared header always shows the target org. Choose another org explicitly or use **Commands & search** (`⌘K`). Switching a workspace target does not change Headful's default org. Existing reviewed workflows and permission proposals remain pinned to their saved org; open a new workspace to use another target.

## Make the header yours

Open **Customize workspace** to hide or reorder optional controls. Save a global default or an override for the current workspace. **Reset global defaults** restores the contributed defaults; **Use global defaults** removes a workspace override. The target selector cannot be hidden. Preferences remain in the local owner-only store.

Enabled Extensions contribute available navigation, panels, commands, actions, and settings. Disable **Admin Utilities** in **Extensions** to remove its contributions and block its service operations. The core connection flows and reviewed workspace remain available. The `compact-results` setting changes utility table density.

## Everyday utilities

- **Org shortcuts** opens the selected org or supported Salesforce Setup destinations. Favorites stay with that org. These are fixed destinations, not arbitrary URLs or CLI commands.
- **Record inspector** reads a record by object API name and Salesforce ID. The core Leads search/detail view also offers **Inspect all readable fields** while this Extension is active. Filter field labels, API names, types, and values; copy individual values, the ID, or structured JSON; open the same record in its original org. Salesforce field permissions still apply.
- **SOQL workspace** runs one read-only `SELECT` query. Object and field suggestions come from CLI schema reads. Queries and history are saved per org; history records query text and execution metadata, without retaining result datasets. Results load in pages of at most 500 rows, with a one-row look-ahead and a 2,000-row offset bound. **Cancel query** terminates the owned CLI child. **Export this page CSV** exports only loaded rows and does not fetch additional pages.
- **Object & field explorer** browses object API names and describes accessible fields, types, picklists, and relationships. Search field labels/API names, select fields for a starter query, and export local schema documentation. It creates or deletes no schema.
- **Org diagnostics** reads supported limits and storage, recent Apex jobs, and available debug logs. Missing CLI capabilities and Salesforce permissions produce useful unavailable states. It performs no job execution or log configuration.

Copied values and exported files are local CRM data. You decide where to share them. Using an external agent provider separately can send selected CRM context to that provider.

## CLI and authority boundary

The command families were checked against Salesforce CLI **2.86.9**: `data query`, `data get record`, `sobject list`, `sobject describe`, `org list limits`, `apex list log`, `apex get log`, and `org open`. The fixed identity check uses CLI-owned `org display` and `api request rest /services/oauth2/userinfo --method GET`; that installed API command prints JSON directly and does not support a `--json` flag.

The runtime validates explicit target usernames, authenticated org/principal/origin, inputs, JSON output shapes, execution time and output size. It executes argument arrays without a shell. Extension permissions grant narrow reads, never an unrestricted CLI capability, Apex execution, credentials, or write approval. Disabled services reject late results; disabling query access aborts active reads. There is no credential-based REST fallback for these utilities.

Users & Access and Permission Sets retain their existing exact human review, expiring single-use approvals, stale-state validation, provider receipts, and unknown-outcome reconciliation. Utility reads cannot bypass those safeguards.

## Scope and distribution

A clean public clone runs `pnpm headful:setup`, `pnpm headful:dev`, and `pnpm headful:package` without a private repository or npm credentials. The proprietary `@headfulcloud/mcp-apps` integration is a separately linked optional compiled package; see [Extensions](EXTENSIONS.md).

This is a Mac beta, initially packaged on Apple Silicon. Mobile source and shared T3 client architecture are preserved; mobile development and distribution are outside this slice. Backups and restore are planned for a separate proprietary Extension. Scheduled snapshots, sandbox seeding, metadata deployment/comparison, bulk imports, and advanced automation are also outside this beta. The utilities do not claim full Salesforce Inspector, ORGanizer, or DevTools parity.
