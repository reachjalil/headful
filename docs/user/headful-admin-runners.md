# Native Admin runners

Headful's native runtime supports two execution patterns for optional installed
Admin integrations. T3 model-provider work uses the existing thread launch,
message, interruption, projection and command-receipt services. Salesforce CLI
work uses the typed native Salesforce service, its verified org/principal target
and validated argument-array processes. The current supported CLI is `sf`, with
a minimum version of `2.136.0`.

An integration can offer these patterns through one durable run lifecycle:
admission, status, exposed activity, content-bound follow-up commands,
interruption and committed results. The integration owns its profiles and
journal; native services remain the execution and authority boundary. Starting
work returns an admission, rather than a claim that the work has completed.

An sf task selects typed actions: bounded SOQL query, list/describe objects,
org diagnostics and list/read Apex logs. Its host supplies the exact org target
and query cancellation identity. It does not need a language-model provider.
Neither a renderer nor an MCP client receives an unrestricted CLI executor or
Salesforce authentication material. Salesforce changes use the existing exact
native review and single-use approval service.

For T3 model turns, only a supported contained provider profile can execute
remote Admin work. The native runner port keeps the integration's threads owned
by that integration and pins project, provider, model, workspace, approved tools
and expiration. A system prompt alone does not enforce an execution boundary.
Provider sandbox acceptance must be verified independently of source checks.

The current contained Codex profile disables provider shell, web, browser,
computer, app/hook, plugin, extra-agent and inherited project-document features.
It selects a unique permission profile with minimal runtime read access, an
isolated read-only workspace and disabled network. Before admitting a session
and before each turn, the adapter checks the provider's returned working
directory, approval policy, effective sandbox and active profile. It also checks
that only the authenticated Headful MCP server and exact granted tool catalog
are connected. Missing or wider effective policy fails before the model turn.
Generic provider configuration cannot replace these native constraints.

`pnpm headful:agent:policy` checks the installed Codex app-server and actual Mac
sandbox against synthetic files and an authenticated loopback MCP. It proves a
workspace read is allowed and an outside read/workspace write are denied, then
checks the returned session policy and connected catalog. It uses a temporary
Codex home without an API key, login or model turn. Compact evidence is written
to `artifacts/headful/native-agent-policy.json`. A passing result does not prove
model routing through the complete T3/Headful orchestration service or a live
Salesforce/ChatGPT task; those require separate end-to-end observations.

Interruption stays a request until native execution confirms it. Query
cancellation targets the exact admitted native request; other bounded reads
finish within their native timeout and must not start further steps. Completed
steps and receipts survive later failures. A restarted integration must recover
its journal and refuse to automatically repeat uncertain dispatches.

These ports do not enable a new desktop chat or change the composed Salesforce
workspace. Public builds remain usable without a private integration, hosted
relay or Headful cloud account. Installed integrations separately declare their
native permissions, configuration, hosted data sharing and release readiness.
