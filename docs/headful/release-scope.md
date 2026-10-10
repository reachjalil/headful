# Current Headful scope

Source reviewed October 10, 2026. Headful remains an unreleased Mac beta. A compiled capability, a visible experience and an accepted distribution are different states.

The normal desktop composes Welcome → Salesforce CLI readiness → explicit org connections → compact admin workspace. The workspace offers objects/fields, query data, record inspection, org health, Setup shortcuts and a Backup & Recovery cloud destination. Settings and the workspace share an exact login selector and preserve per-org drafts. Local mods have their own inspection, grants and lifecycle controls. The backup destination requires separate cloud authorization; it does not turn native credentials into a cloud session.

## Compose at the owning boundary

| Boundary                          | Selection                                                                 | Authority                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Visible desktop experience        | `packages/contracts/src/headful-experiences.ts`                           | Exposure alone grants no service access                                                    |
| Workspace tools and actions       | Mod navigation/action contributions and registered host component slots   | The host checks artifact revision, grants, feature state and org                           |
| Mod installation and distribution | Explicit compiled composition and declared dependencies                   | Exact artifact hashes determine native trust; community installation uses the sandbox      |
| Salesforce operation              | Typed native service with exact verified org/principal                    | CLI credentials remain native; consequential changes require exact single-use human review |
| Optional remote execution         | Installed integration, explicit native grant and contained runner profile | Native admission/status/receipts remain authoritative; cloud dispatch is not completion    |

The public app and admin utilities build without the private repository, cloud account or private registry. Optional integrations declare their own dependencies. Disabling or omitting an integration must leave local onboarding and read-only admin work available. A module's license does not implement billing or grant Salesforce authority.

## Evidence and release limits

The current review passes Headful service/component tests, scoped provider launch/adapter tests, the installed Codex permission probe, workspace/setup browser journeys, saved experience recipes and a production exposure audit. Browser fixtures use fictional records. The permission probe uses synthetic local files and no model turn. Neither proves a live Salesforce workflow or an accepted ChatGPT connection.

The retained Apple Silicon application is a prior beta artifact. Source integration does not rebuild that artifact automatically. A selected release must identify its exact source, compiled mod hashes, package hash and actual verification. Developer ID signing, notarization, fresh-user installation and approved public distribution remain separate steps. Intel and mobile distribution require their own actual evidence; preserving source does not claim distribution support.

Normal startup must keep development fixtures and interaction/capture controls out of production JavaScript. Use `pnpm headful:exposure apps/web/dist` after the current web build. Use focused experience recipes for selected flows, then native/live checks where those flows cross a real service boundary. A retained advanced service or provider adapter is available for future design, rather than an automatic customer feature.
