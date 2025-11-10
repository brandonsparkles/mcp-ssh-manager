# Tool Management Guide

## Overview

MCP SSH Manager provides **37 tools** organized into **6 functional groups**. You can enable or disable tool groups to customize your experience and reduce context usage in Claude Code.

### Why Manage Tools?

- **Reduce Context Usage**: By default, all 37 tools consume ~43.5k tokens in Claude Code. Minimal mode uses only ~3.5k tokens (92% reduction)
- **Fewer Approval Prompts**: Only enabled tools require approval in Claude Code
- **Faster Loading**: Less tools mean faster MCP server startup
- **Cleaner Interface**: Only see the tools you actually use

## Quick Start

### View Current Configuration

```bash
ssh-manager tools list
```

### Interactive Configuration Wizard

```bash
ssh-manager tools configure
```

Choose from three modes:
1. **All tools** (37 tools) - Full feature set, recommended for most users
2. **Minimal** (5 tools) - Only core operations, maximum efficiency
3. **Custom** - Pick which groups to enable

### Enable/Disable Specific Groups

```bash
# Enable a group
ssh-manager tools enable monitoring

# Disable a group
ssh-manager tools disable backup
```

### Reset to Defaults

```bash
ssh-manager tools reset
```

### Export Auto-Approval Configuration

```bash
ssh-manager tools export-claude
```

This generates configuration for Claude Code to auto-approve your enabled tools.

## Tool Groups

### Core (5 tools) ✨ Always Enabled

Essential SSH operations for basic functionality:

- `ssh_list_servers` - List all configured SSH servers
- `ssh_execute` - Execute commands on remote servers
- `ssh_upload` - Upload files to remote servers
- `ssh_download` - Download files from remote servers
- `ssh_sync` - Bidirectional file synchronization with rsync

**When to use**: Always enabled. These are the minimum tools needed for SSH operations.

### Sessions (4 tools)

Persistent SSH session management:

- `ssh_session_start` - Start a persistent SSH session
- `ssh_session_send` - Send command to an existing session
- `ssh_session_list` - List all active sessions
- `ssh_session_close` - Close a persistent session

**When to use**: Enable if you need to maintain state across multiple commands or run interactive sessions.

### Monitoring (6 tools)

System health checks and monitoring:

- `ssh_health_check` - Comprehensive server health check (CPU, RAM, disk, network)
- `ssh_service_status` - Check status of services (nginx, mysql, docker, etc.)
- `ssh_process_manager` - List, monitor, or kill processes
- `ssh_monitor` - Real-time system resource monitoring
- `ssh_tail` - Tail log files in real-time
- `ssh_alert_setup` - Configure health monitoring alerts and thresholds

**When to use**: Enable for server administration, DevOps work, or troubleshooting.

### Backup (4 tools)

Automated backup and restore:

- `ssh_backup_create` - Create database or file backups
- `ssh_backup_list` - List all available backups
- `ssh_backup_restore` - Restore from previous backups
- `ssh_backup_schedule` - Schedule automatic backups using cron

**Supports**: MySQL, PostgreSQL, MongoDB, files

**When to use**: Enable for database administration or when managing production servers.

### Database (4 tools)

Database operations:

- `ssh_db_dump` - Create database dumps
- `ssh_db_import` - Import SQL dumps or restore databases
- `ssh_db_list` - List databases or tables/collections
- `ssh_db_query` - Execute read-only SELECT queries

**Supports**: MySQL, PostgreSQL, MongoDB

**When to use**: Enable for database administration or data migration tasks.

### Advanced (14 tools)

Advanced features for power users:

- `ssh_deploy` - Smart deployment with automatic permission handling
- `ssh_execute_sudo` - Execute commands with sudo privileges
- `ssh_alias` - Manage server aliases (shortcuts)
- `ssh_command_alias` - Manage command aliases
- `ssh_hooks` - Automation hooks system
- `ssh_profile` - Profile management
- `ssh_connection_status` - Connection management and pooling
- `ssh_tunnel_create` - Create SSH tunnels (local/remote/SOCKS)
- `ssh_tunnel_list` - List active tunnels
- `ssh_tunnel_close` - Close SSH tunnels
- `ssh_key_manage` - SSH host key management
- `ssh_execute_group` - Execute commands on server groups
- `ssh_group_manage` - Manage server groups
- `ssh_history` - View command history

**When to use**: Enable for advanced automation, deployment workflows, or managing multiple servers.

## Configuration Modes

### All Tools Mode

```json
{
  "mode": "all",
  "groups": {
    "core": { "enabled": true },
    "sessions": { "enabled": true },
    "monitoring": { "enabled": true },
    "backup": { "enabled": true },
    "database": { "enabled": true },
    "advanced": { "enabled": true }
  }
}
```

- **Enabled tools**: 37/37
- **Context usage**: ~43.5k tokens
- **Best for**: Users who need all features

### Minimal Mode

```json
{
  "mode": "minimal",
  "groups": {
    "core": { "enabled": true },
    "sessions": { "enabled": false },
    "monitoring": { "enabled": false },
    "backup": { "enabled": false },
    "database": { "enabled": false },
    "advanced": { "enabled": false }
  }
}
```

- **Enabled tools**: 5/37
- **Context usage**: ~3.5k tokens
- **Context savings**: 92% reduction (~40k tokens saved)
- **Best for**: Simple SSH operations, file transfers, basic command execution

### Custom Mode

```json
{
  "mode": "custom",
  "groups": {
    "core": { "enabled": true },
    "sessions": { "enabled": true },
    "monitoring": { "enabled": true },
    "backup": { "enabled": false },
    "database": { "enabled": false },
    "advanced": { "enabled": false }
  }
}
```

- **Enabled tools**: Custom (5-37 tools)
- **Context usage**: Varies based on selection
- **Best for**: Tailoring to specific workflows

## Configuration File

### Location

- **User-global**: `~/.ssh-manager/tools-config.json`

### Structure

```json
{
  "version": "1.0",
  "mode": "minimal|all|custom",
  "groups": {
    "core": { "enabled": true },
    "sessions": { "enabled": false },
    "monitoring": { "enabled": false },
    "backup": { "enabled": false },
    "database": { "enabled": false },
    "advanced": { "enabled": false }
  },
  "tools": {
    "ssh_session_start": true  // Individual tool override
  },
  "_comment": "Tool configuration for MCP SSH Manager"
}
```

### Individual Tool Overrides

You can override group settings for specific tools:

```json
{
  "mode": "minimal",
  "groups": {
    "sessions": { "enabled": false }
  },
  "tools": {
    "ssh_session_start": true  // Enable this tool despite group being disabled
  }
}
```

## Use Cases

### Scenario 1: Web Developer (Basic SSH)

**Need**: Upload files, run build commands, restart services

**Recommended**: Minimal mode + monitoring

```bash
ssh-manager tools configure  # Choose "2) Minimal"
ssh-manager tools enable monitoring
```

**Result**: 11 tools (5 core + 6 monitoring) = ~7k tokens

### Scenario 2: DevOps Engineer

**Need**: Full server management, monitoring, backups

**Recommended**: All tools mode

```bash
ssh-manager tools configure  # Choose "1) All tools"
```

**Result**: 37 tools = ~43.5k tokens

### Scenario 3: Database Administrator

**Need**: Database operations, backups, monitoring

**Recommended**: Custom mode

```bash
ssh-manager tools configure  # Choose "3) Custom"
# Enable: monitoring, backup, database
```

**Result**: 19 tools (5 core + 6 monitoring + 4 backup + 4 database) = ~15k tokens

### Scenario 4: Security-Conscious User

**Need**: Minimal attack surface, only essential tools

**Recommended**: Minimal mode only

```bash
ssh-manager tools configure  # Choose "2) Minimal"
```

**Result**: 5 tools = ~3.5k tokens (minimum possible)

## Claude Code Integration

### Auto-Approval Configuration

After configuring your tools, export the auto-approval configuration:

```bash
ssh-manager tools export-claude
```

This generates a JSON snippet like:

```json
{
  "autoApprove": {
    "tools": [
      "mcp__ssh-manager__ssh_list_servers",
      "mcp__ssh-manager__ssh_execute",
      "mcp__ssh-manager__ssh_upload",
      "mcp__ssh-manager__ssh_download",
      "mcp__ssh-manager__ssh_sync"
    ]
  }
}
```

### Adding to Claude Code Config

1. Open `~/.config/claude-code/claude_code_config.json`
2. Add or merge the `autoApprove` section
3. Save and restart Claude Code

Example complete config:

```json
{
  "mcpServers": {
    "ssh-manager": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-ssh-manager/src/index.js"]
    }
  },
  "autoApprove": {
    "tools": [
      "mcp__ssh-manager__ssh_list_servers",
      "mcp__ssh-manager__ssh_execute",
      "mcp__ssh-manager__ssh_upload",
      "mcp__ssh-manager__ssh_download",
      "mcp__ssh-manager__ssh_sync"
    ]
  }
}
```

## Troubleshooting

### Tools Not Disabled After Configuration

**Cause**: MCP server is still running with old configuration

**Solution**: Restart Claude Code or run `claude mcp restart`

### Config File Not Found

**Cause**: No configuration file exists yet

**Solution**: Run `ssh-manager tools configure` to create one

### Can't Disable Core Group

**Cause**: Core tools are required for basic functionality

**Solution**: Core group cannot be disabled. Consider minimal mode if you want the absolute minimum tools.

### Changes Not Reflected in Claude Code

**Cause**: Claude Code caches MCP server configuration

**Solution**:
1. Restart Claude Code
2. Or use Claude Code's MCP server management commands
3. Verify with `ssh-manager tools list`

## Best Practices

### 1. Start with Minimal, Enable as Needed

Begin with minimal mode and enable groups as you discover you need them:

```bash
ssh-manager tools configure  # Choose minimal
# ... later when you need monitoring ...
ssh-manager tools enable monitoring
```

### 2. Use Tool List Regularly

Check what's enabled before starting work:

```bash
ssh-manager tools list
```

### 3. Different Configs for Different Projects

While MCP SSH Manager uses a single user-global config, you can:
- Create shell aliases for different profiles
- Manually switch configs for different projects
- Use the CLI to quickly enable/disable groups

### 4. Export Auto-Approval After Changes

Whenever you modify tool configuration, update your Claude Code auto-approval:

```bash
ssh-manager tools enable backup
ssh-manager tools export-claude
# Copy the output to claude_code_config.json
```

### 5. Document Your Configuration

Add comments to your config file to remember why you enabled specific groups:

```json
{
  "_comment": "Custom config for web development projects. Monitoring enabled for debugging deployment issues. Backup disabled as we use external backup solutions."
}
```

## FAQ

### Q: Will existing users see any changes?

**A**: No. If no configuration file exists, all 37 tools are enabled by default (current behavior).

### Q: Can I enable individual tools without enabling the whole group?

**A**: Yes! Use the `tools` object in the config file for individual overrides.

### Q: What happens to new tools in future updates?

**A**: New tools default to enabled unless you've explicitly disabled their group.

### Q: Can I have different configs for different servers?

**A**: Currently, tool configuration is user-global. Server-specific tool configs may be added in a future version.

### Q: Does this affect the Node.js API?

**A**: Only if you're using the MCP server. Direct use of the Node.js SSH Manager class is unaffected.

### Q: How much does minimal mode actually save?

**A**: Minimal mode (5 tools) uses ~3.5k tokens vs all tools (37 tools) at ~43.5k tokens. That's a **92% reduction** or **~40k tokens saved**.

## Command Reference

| Command | Description |
|---------|-------------|
| `ssh-manager tools list` | Show all tools and their current status |
| `ssh-manager tools configure` | Interactive configuration wizard |
| `ssh-manager tools enable <group>` | Enable a tool group |
| `ssh-manager tools disable <group>` | Disable a tool group |
| `ssh-manager tools reset` | Reset to defaults (all tools enabled) |
| `ssh-manager tools show` | Display raw configuration file |
| `ssh-manager tools export-claude` | Generate Claude Code auto-approval config |

## See Also

- [README.md](../README.md) - Main project documentation
- [CLAUDE.md](../CLAUDE.md) - Instructions for Claude Code AI
- [Tool Registry Source](../src/tool-registry.js) - Tool group definitions
- [Config Manager Source](../src/tool-config-manager.js) - Configuration logic
