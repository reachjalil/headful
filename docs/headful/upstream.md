# Updating the T3 Code foundation

Retain the real fork relationship and upstream history. `origin` is `reachjalil/headful`; `upstream` is `pingdotgg/t3code`. The recorded base is in `headful-upstream.json`.

1. On a clean checkout, run `pnpm headful:upstream status`. Select a reviewed tag or commit.
2. Run `pnpm headful:upstream prepare <ref>` to fetch and create `codex/headful-upstream-<commit>`.
3. Merge the selected commit normally with `git merge --no-ff <commit>`. Resolve conflicts around the documented seams; do not reset or copy the upstream tree over Headful.
4. Inspect changed runtime contracts, Effect versions, desktop boot/protocol/data identity, local authentication, and package externals. Preserve `apps/mobile` and `packages/client-runtime`; do not introduce Electron/Node into portable contracts.
5. Run the affected tests/typechecks, one startup/tray check, fixture Salesforce approval checks when relevant, and `pnpm headful:package` when the package boundary changes. Review the app and packaged helper before integration.
6. Update upstream metadata and the desktop About base together; commit the merge and adaptation changes. Review and merge through the normal human review process. Releases remain a separate decision.

Adaptation seams: `apps/server/src/headful` owns Salesforce services and loopback transports; `packages/contracts/src/headful*` owns portable contracts; `apps/web/src/headful` owns the focused UI; `apps/desktop/src/headful` owns IPC/tray; upstream `server.ts`, desktop `DesktopApp.ts`, preload, identity/protocol and web `main.tsx` contain small integration hooks. `scripts/headful*`, the icon generator and upstream artifact pipeline own Mac builds. Retained upstream chat/providers are optional. Headful does not use upstream telemetry, hosted auth/relay, or updater destinations.

A future mobile companion must add explicit authenticated pairing, scoped grants, encrypted transport, revocation and context binding. The current Salesforce runtime binds loopback and rejects browser origins. Do not expose it to LAN by changing the bind host.
