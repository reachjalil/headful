# Local Headful mods

The public Mac foundation, native Salesforce authority, installer, SDK and deliberately open admin utilities build from this repository alone. Mods have namespaced IDs independent of npm names. Private first-party implementations are compiled in a separate repository and supplied only through an explicit assembly directory. Normal startup is Welcome → Salesforce CLI readiness → org connections → the compact admin workspace, with Setup and the settings cog. Five direct read-only tools use the current org; mod management lives in Settings → This Mac → Local mods.

## Contributor workflow

```sh
pnpm headful:setup
node examples/hello-mod/build.mjs
pnpm headful:mods pack examples/hello-mod artifacts/mods/org.example.hello.headfulmod
pnpm headful:mods inspect artifacts/mods/org.example.hello.headfulmod
pnpm headful:dev
```

Open settings → Local mods, choose the `.headfulmod` file, inspect its identity and hash, review permissions in the native dialog, and enable it. Installing an updated artifact uses the same picker; its new revision needs a new permission review. The useful `org.example.hello` example needs no Salesforce login or Headful account. It supplies a local counter command, an overview view, a schema-checked greeting API and a declared host-event counter. `pnpm headful:mods:journey` verifies it through the real Electron sandbox, loader and broker.

Copy `examples/hello-mod` for another mod. Its build bundles the public `packages/mod-sdk/src/index.ts` into one browser script. Export `globalThis.activateHeadfulMod(channel)` and register handlers with `createModSdk(channel)`. SDK methods include `command`, `api`, `view`, `event`, `background`, `callApi`, scoped `settings`/`storage`, `cleanup`, `signal` and `dispose`. Views return bounded Markdown data rendered by the host; they do not inject native DOM or arbitrary app HTML.

`headful.mod.json` uses separate `schemaVersion: 1`, mod `version` and `hostApi: "^1.0.0"` (numeric `apiVersion: 1` selects the typed native API). Declare namespaced `id`, supported platforms, execution/entry points, required `permissions`, `optionalPermissions`, activation triggers, versioned dependencies, settings, command/API input and output schemas, contributions, subscriptions, resources and license/distribution metadata. A source URL is optional. The authoritative strict schema is `packages/contracts/src/headful-mods.ts`; portable value schemas are in `packages/mod-sdk/src/schema.ts`. Version constraints support exact versions and caret ranges. Unknown fields, malformed schemas, cycles, collisions and incompatible requirements fail closed.

## Contribute to the editor

The editor reads navigation names, icons and order from installed manifests. Reviewed built-in admin components occupy the compact tool strip. Additional mod tools are searchable in the **Tools** menu, identify their supplying mod, and open inside the editor with Workspace breadcrumbs. Disabled, incompatible, failed or unreviewed tools show their availability reason. The host never imports a renderer component by a path supplied in a manifest.

Declare a `navigation` item with exactly one target: `componentId` for a host-registered reviewed native component, or `surfaceId` for a declared view. Community mods use the latter. A view is host-rendered bounded Markdown with tables and inline/display math (`$…$` and `$$` blocks). The host supplies Source, Split and Preview modes and a read-only source editor. Raw HTML, images, executable links and trusted KaTeX resource/HTML commands are excluded. Opening or explicitly refreshing a view calls `mods.surface`; switching document modes uses the loaded result without another mod call. Metadata discovery does not execute mod code.

Declare an `actions` item referencing a command. Its `workspaceIds` contain navigation contribution IDs; an empty list makes the action available across tools. `placement: "primary"` requests a toolbar button; the host shows at most two and puts additional actions in the Tools menu. `placement: "overflow"` requests that menu directly. Commands needing inputs open Local mods configuration; the editor can supply only a declared string `org-id`, bound to the workspace's original connection. An action never runs merely because it becomes visible. Icons use the host's bounded icon vocabulary and retain text labels.

The account-free example declares both locations:

```json
{
  "navigation": [
    {
      "id": "org.example.hello/counter",
      "name": "Local counter",
      "surfaceId": "overview",
      "icon": "activity",
      "requiresOrg": false
    }
  ],
  "actions": [
    {
      "id": "org.example.hello/hello",
      "name": "Say hello",
      "commandId": "org.example.hello/hello",
      "icon": "star",
      "placement": "primary",
      "workspaceIds": ["org.example.hello/counter"],
      "requiresOrg": false
    }
  ]
}
```

The same namespaced IDs survive display-name and ordering changes. Mounted tool state belongs to the exact mod artifact revision and org workspace. Revoking availability removes the contributed view; unrelated drafts stay mounted. Editor requests carry the rendered artifact revision, and the native service rejects a replaced artifact before activation or invocation. Configured feature state can expose an enabled dormant tool; it does not grant active service authority. The runtime still checks activation, permissions, current feature/client/org authority and exact human review for consequential operations.

Place each feature according to the job it serves:

| Location                         | Purpose                                                      | Current composition                                                             |
| -------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Global bar                       | Exact org/login selection, CLI readiness, Settings           | Host owned; mods cannot replace the org or approval controls                    |
| Tool strip / Tools menu          | A destination with its own sustained task                    | Declarative navigation and icons implemented                                    |
| Active tool toolbar / Tools menu | A verb relevant to that destination                          | Declarative primary and overflow actions implemented                            |
| Main editor                      | The task's working content                                   | Reviewed native component or bounded mod view implemented                       |
| Reference dock                   | Fields, saved work, explanations supporting the current task | Query reference exists; general mod insertion waits for its first designed flow |
| Results area / status strip      | Output and connection state                                  | Current host/tool owned; no generic mod output injection                        |
| Settings → Local mods            | Install, review, enable, configure and remove                | Native authority and declared editor locations are inspectable here             |

Keep the tool strip small as capabilities grow. Additional destinations belong in the searchable menu; secondary actions stay with their task. Retained `headerControls`, `panels`, routes and menu-bar metadata are not automatic insertion points in the current editor. Add a host-owned slot when an actual feature needs it, reuse the same identity/lifecycle registry, and design its recovery and isolated recipe before composing it. Avoid arbitrary CSS/DOM selectors, automatically generated settings sections and a separate UI loader.

## Permission and trust model

Community mods run in separate hidden Electron renderers with Chromium sandboxing, context isolation, disabled Node integration, a port-only preload, strict CSP and host-owned message ports. Network, navigation, popups, frames, workers, webviews and browser/device permissions are denied. Only the compiled entry and explicitly exposed contained resources can load. No native object, credential, generic process, file path, HTTP proxy or CLI runner reaches community code.

The current community broker exposes reviewed scoped settings, bounded private storage and calls to other community APIs. It exposes no Salesforce or network operation. Cross-mod APIs require `mods:api`, schema validation and a provider permission ceiling; community-to-native calls are denied. A provider adapter requires explicit host enforcement of verified org/principal and current client/feature authority. Declaring a permission never implements or grants such an adapter.

Reviewed native mods run as trusted Node code. Only an explicit host composition with the artifact's exact SHA-256 can approve native execution. Ordinary installation and agent calls cannot approve it. A developer controlling their own fork may deliberately edit that host policy. Native code can access its process; the typed runtime port constrains application authority, not arbitrary trusted-code behavior. Hashes establish integrity. Signing, if added, establishes provenance and cannot make arbitrary code safe. Compiled or minified JavaScript remains inspectable.

Runtime authority remains in the public native service. Salesforce CLI owns authentication. A mod cannot issue human approval or execute a consequential provider write through its service port. Current feature/client/org policy and exact expiring, single-use workflow review still apply. Unknown writes require reconciliation without automatic retry.

## Lifecycle, data and limits

Installation stages and validates the artifact before atomically replacing the installed index. Metadata discovery does not execute native mod code. Enabled mods remain inactive until a declared command, view, API or host event activates them. Background work requires a separate native confirmation. Disable/revocation abort execution, listeners, pending calls and handles. Failures affect the mod rather than the host; late/replaced contexts are rejected. Dependencies stop with their unavailable provider. Uninstall preserves data. Permanent mod-data deletion has a separate native confirmation and cannot delete CLI logins, orgs or durable workflows.

Artifacts use the uncompressed, self-contained JSON format `headfulmod-1`: manifest, base64 compiled files and SHA-256 inventory. There is no nested archive extraction. Limits are 64 MiB container, 40 MiB decoded, 2,048 files and 8 MiB per file. ASCII contained paths prevent case/Unicode collisions; absolute paths, traversal, duplicate/colliding paths, symlinks, implementation TypeScript, source maps and unexpected types are rejected. LICENSE and THIRD_PARTY_NOTICES are required. Embedded source maps, private source paths and secret patterns are audited.

A reviewed native artifact can declare a private Mac helper as a resource with
`executable: true`, `exposed: false` and an exact `./dist/native/<name>` path.
Community/exposed helpers and script payloads are rejected; native executable
inventory requires a Mach-O header and exact size/hash. This identifies format
and integrity, not code safety. Extraction gives that declared helper mode 0700,
ordinary files mode 0600, and activation checks executable permission and bytes.
The existing exact-hash native trust policy still controls whether code runs.
Executable resources are never served to a community renderer or MCP client.

Messages are serializable and at most 256 KiB with depth/collection bounds. Execution has a 10-second call deadline, 32 pending requests, 128 messages/second, 16 simultaneous sandboxes and a 256 MiB resident-memory monitor. Memory enforcement is a periodic process monitor, not an OS hard quota. Storage is 100 keys/1 MiB per mod. Native export storage is 100 files/10 MiB, with 1 MiB per receipt-producing export. The host owns paths and returns opaque artifact handles.

## Build lanes

`pnpm headful:package` includes only the deliberately public admin mod from `artifacts/mods/composition.json`. No sibling checkout detection, private package resolution or npm login is used. `HEADFUL_ASSEMBLY_MODS_DIR` explicitly adds a validated compiled composition for maintainer assembly; selected missing/invalid artifacts abort packaging. `HEADFUL_DEVELOPMENT_MODS_DIR` explicitly selects compiled development artifacts, with the same authority checks. Production uses bundled artifacts from application resources. The app includes required legal notices, the local runtime and the public SDK with its generated declarations in Resources/headful/sdk. Private implementation declarations are excluded from mod artifacts.

Headful application mods and external Codex/Claude/ChatGPT agent-plugin ZIPs are distinct formats/runtimes. A native mod can contribute an agent integration through the existing single MCP router. It must not create another Salesforce executor or independent approval system.

The isolated `/?experience=mod-management` and `/?experience=reference-mod` previews are clearly labeled development fixtures with reset/replay recipes. They cannot install artifacts or approve permissions. Production removes their modules and app-control surface. Mac-first platform declarations keep desktop-native code out of mobile; upstream `apps/mobile` and shared client architecture remain preserved.
