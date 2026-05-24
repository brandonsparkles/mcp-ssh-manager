# Tool Management

This document reflects current behavior in:
- Runtime activation: `src/index.js`, `src/tool-config-manager.js`
- CLI management: `cli/commands/tools.sh`

## What gets activated at runtime

- Config file path: `~/.ssh-manager/tools-config.json`
- On server startup, `loadToolConfig()` is called once.
- Each tool is registered through `registerToolConditional(...)`.
- If a tool is disabled, it is **not registered** in MCP.
- Config changes require MCP server restart to take effect.

If no config file exists (or config is invalid), runtime falls back to default: **all 39 tools enabled**.

## Tool groups (39 total)

- `core` (6): `ssh_list_servers`, `ssh_execute`, `ssh_python_as_user`, `ssh_upload`, `ssh_download`, `ssh_sync`
- `sessions` (4)
- `monitoring` (6)
- `backup` (4)
- `database` (4)
- `advanced` (15)

## Config modes and precedence

Modes:
- `all`: all tools enabled
- `minimal`: only `core` enabled
- `custom`: group-level enable/disable via `groups`

Runtime enablement order (`isToolEnabled`):
1. `mode=all` => enabled
2. Per-tool override in `tools[toolName]` (if present)
3. `mode=minimal` => only `core`
4. `mode=custom` => `groups[group].enabled`
5. Unknown/new tool fallback => enabled

## CLI commands (actual)

```bash
ssh-manager tools list
ssh-manager tools configure
ssh-manager tools enable <group>
ssh-manager tools disable <group>
ssh-manager tools show
ssh-manager tools export-claude
ssh-manager tools reset
```

Aliases supported:
- `list|ls`
- `configure|config|setup`
- `enable|on`
- `disable|off`
- `show|status`
- `export-claude|export`

## Command behavior details

### `tools configure`
Interactive wizard writing one of:
- `mode=all`
- `mode=minimal`
- `mode=custom`

### `tools enable <group>`
- Valid groups: `core`, `sessions`, `monitoring`, `backup`, `database`, `advanced`
- Creates config file if missing (starts in `custom` mode)
- If current mode is `all` or `minimal`, converts to `custom` first

### `tools disable <group>`
- Valid groups: `sessions`, `monitoring`, `backup`, `database`, `advanced`
- `core` group cannot be disabled via CLI
- Creates config file if missing (all groups enabled, then disables requested group)
- If mode is `all`, converts to `custom`

### `tools reset`
- Deletes `~/.ssh-manager/tools-config.json` (with confirmation)
- Result after restart: default runtime behavior (all tools enabled)

### `tools show`
- Pretty-prints the raw JSON config with `jq`

### `tools export-claude`
- Requires existing config file
- Prints `autoApprove.tools` entries as `mcp__ssh-manager__<tool>`
- For `custom` mode, export is derived from **group flags** in CLI logic
  (not from per-tool `tools` overrides)

## Example configs

Minimal:
```json
{
  "version": "1.0",
  "mode": "minimal",
  "groups": {
    "core": { "enabled": true },
    "sessions": { "enabled": false },
    "monitoring": { "enabled": false },
    "backup": { "enabled": false },
    "database": { "enabled": false },
    "advanced": { "enabled": false }
  },
  "tools": {}
}
```

Custom with per-tool override:
```json
{
  "version": "1.0",
  "mode": "custom",
  "groups": {
    "core": { "enabled": true },
    "sessions": { "enabled": false },
    "monitoring": { "enabled": true },
    "backup": { "enabled": false },
    "database": { "enabled": false },
    "advanced": { "enabled": false }
  },
  "tools": {
    "ssh_session_start": true
  }
}
```

## Operational note

After any `ssh-manager tools ...` change, restart MCP host/client (for example, restart Claude Code or run `claude mcp restart`) so tool registration is rebuilt.
