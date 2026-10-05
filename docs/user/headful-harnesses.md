# Connect Headful to your agent

Start Headful on your Mac and connect or import a Salesforce org. Enable agent access on the org, then open **Integrations**. Create a named local grant, select its orgs, and choose read access or supported administration proposals. A grant never authorizes Salesforce writes: those require an exact human review in the Headful desktop.

Select your client and grant, preview the configuration, then install it. Headful changes its own `headful` entry, preserves unrelated settings, makes an owner-only backup, and writes atomically. If an existing entry was changed outside Headful, installation or removal stops so your edits remain intact. Restart or refresh the client's MCP connection after configuration changes. Paths with spaces are supported.

| Client                       | Local setup                                                                                               | Configuration and limits                                                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ChatGPT desktop / Codex      | Choose **Codex** in Integrations.                                                                         | Supported local Codex hosts share `~/.codex/config.toml`; Headful installs a stdio server. ChatGPT web's hosted connectors cannot reach the Mac's loopback address.       |
| Claude Code                  | Choose **Claude Code**.                                                                                   | Installs the supported user-scoped `mcpServers.headful` entry in `~/.claude.json`. A client or organization policy may restrict local MCP.                                |
| Claude Desktop               | Choose **Claude Desktop**.                                                                                | Adds the local stdio entry to `~/Library/Application Support/Claude/claude_desktop_config.json`. Restart the desktop client. MCP Apps rendering varies by client version. |
| Claude Cowork / local plugin | Choose **Plugin**, then install the bundled plugin through the client's supported local plugin mechanism. | Local plugin use requires the desktop/local host. A hosted web connector cannot use this launcher. Availability and policy are controlled by Claude.                      |
| OpenCode                     | Choose **OpenCode**.                                                                                      | Uses the supported `mcp.headful` local entry in `~/.config/opencode/opencode.json`, or preserves an existing `opencode.jsonc` profile and its comments.                   |
| Other local MCP client       | Choose **Generic**.                                                                                       | Copy the generated `mcpServers.headful` entry from `~/.headful/generic-mcp.json` into the client's supported configuration. It launches Headful's packaged stdio bridge.  |

For manual supported CLI setup, use the generated launcher rather than a Salesforce token:

```sh
codex mcp add headful -- "$HOME/.headful/bin/headful-mcp-codex"
claude mcp add --scope user --transport stdio headful -- "$HOME/.headful/bin/headful-mcp-claude-code"
```

Do not run these commands on top of a Headful-managed entry without first removing that entry in Integrations. Client CLI installation is optional; no agent client is required for managing orgs.

Headful's plugin includes focused skills for administration, leads, permission sets and user creation. The app ships an early-access plugin ZIP; the public source is at [`plugins/headful`](../../plugins/headful). In Codex, add the repository marketplace through the supported plugin interface. In Claude Code, the local development path is `claude --plugin-dir /absolute/path/to/plugins/headful`. Native plugin stores and host-specific publication are separate from this local configuration.

**What runs locally.** The installed Headful app owns one Salesforce service and one durable workflow store. Its packaged bridge uses the app's embedded runtime; installed users do not need Node, npm or a source checkout. Each bridge forwards MCP requests to the app's authenticated Mac loopback endpoint. It never creates a second executor, starts an invisible background Salesforce service, or automatically launches the app.

Closing the workspace leaves the menu bar and local MCP running. Disconnecting a harness closes its bridge; other clients and Headful keep working. Restarting Headful refreshes its runtime address, and bridges read that address on each request. A crash or Quit stops local MCP. Reopen Headful and refresh the client's connection. Prepared workflows remain local; uncertain provider writes are reconciled without retrying them.

**Revoke or uninstall.** Revoke a client grant in Integrations to immediately deny future tools and resources. Removing a Headful-owned harness entry also removes its launcher and revokes its grant. Other settings remain. Revocation cannot undo information already returned to a chat provider. Removing a Headful org reference does not log it out of Salesforce CLI; explicit CLI logout is a separate action that can affect other tools.

**Credentials and records.** Salesforce credentials remain owned by Salesforce CLI. Headful-specific client grants use separate owner-only credential files and a hash-only metadata store; harness configuration and diagnostics contain no token values. Your Salesforce credentials and CRM records are never routed through Headful's servers in local desktop mode. Salesforce operations go directly from the Mac to Salesforce. Selected results returned to your chosen agent may reach that AI provider. The website waitlist collects email separately.

Compatibility guidance was checked against the official [OpenAI local MCP documentation](https://developers.openai.com/codex/mcp), [OpenAI plugin documentation](https://developers.openai.com/plugins/build/plugins), [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp), [Claude local connector guidance](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop), [Claude desktop and web connector boundaries](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors), and [OpenCode MCP documentation](https://opencode.ai/docs/mcp-servers/). Protocol and configuration checks do not claim native acceptance in every host or store approval.
