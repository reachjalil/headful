# Experiences

Headful is built one user experience at a time. An experience is a bounded user outcome with its own component, labeled fixtures, stable test IDs and a saved recipe. It stays out of normal startup until it is deliberately composed.

## One manifest

`packages/contracts/src/headful-experiences.ts` lists every experience that exists in code: its exposure, fixtures, ordered step ids, source files and recipe. The shell, native development control, browser recipe runner and production exposure check all read it. Adding an experience means one manifest entry, one preview loader in `apps/web/src/headful/experience-views.ts`, and the experience's own files.

| Exposure   | Meaning                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`  | Available in the composed desktop: `salesforce-setup`, `admin-workspace`, and `org-settings` / `mod-management` through Settings. |
| `dev-only` | Reachable only as an isolated development preview. Never in a production bundle.                                                  |

An experience without a manifest entry does not exist in code.

## Isolated previews

With the web development server running (see [Salesforce setup](salesforce-setup.md)), open `/?experience=<id>&fixture=<name>&step=<step>`. Each preview shows a labeled fixture banner with Reset / replay and makes no Salesforce requests. Fixtures pass through the production result schemas, so fictional data cannot drift from the real contract.

Experiences mark their root with `data-experience`, `data-experience-step` and `aria-busy`. Interaction steps wait until the experience is no longer busy before the next assertion.

## Evidence ladder

Run the cheapest layer that can catch the change, then move up only when the change needs it.

| Layer                                    | Command                                   | Typical time          | Proves                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | ----------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Conformance, component and service tests | `pnpm headful:experience:test`            | ~3 s                  | Recipes compile under native rules, steps and fixtures are declared, components and fixtures obey contracts                                                                                                                                                                          |
| Browser recipe                           | `pnpm headful:experience <id> [<id> ...]` | ~1.3 s per experience | The saved recipe passes against the isolated preview; screenshots and a source-digest report                                                                                                                                                                                         |
| Admin journey                            | `pnpm headful:admin:journey`              | ~6 s                  | Starter queries, saved/history reference panels, explicit execution and CSV export, editor/result viewport use, record navigation, top org switching/search/management, shared Settings context, draft preservation, breadcrumbs, history/reload, reset, keyboard and narrow layouts |
| Setup journey                            | `pnpm headful:setup:journey`              | ~6 s                  | Deep setup behavior: narrow layout, links, reconnect, both Setup entry points                                                                                                                                                                                                        |
| Production exposure                      | `pnpm headful:exposure <web dist>`        | build ~25 s           | Dev-only experiences, fixtures and app control are absent from shipped JavaScript                                                                                                                                                                                                    |
| Native recipe                            | paired development desktop control        | —                     | The same recipe in the Electron app                                                                                                                                                                                                                                                  |
| Live Salesforce                          | a human sign-in to a sandbox              | —                     | The real service boundary                                                                                                                                                                                                                                                            |
| Packaged                                 | `pnpm headful:package`                    | —                     | The distributable launches                                                                                                                                                                                                                                                           |

The browser runner and native control share one recipe compiler (`apps/desktop/src/headful/ControlProtocol.ts`). Recipes are `await app.method({...});` statements with JSON arguments only. Assertions read `flow`, `fixture`, `step`, `empty`, `controls` and `alerts`. Runs stop on the first failure and never retry.

Fixture and browser evidence never stand in for native, live Salesforce or packaged evidence.
