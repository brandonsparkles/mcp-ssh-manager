# Quick Start Guide - MCP SSH Manager

Get up and running in 5 minutes! 🚀

## 1️⃣ Install (1 minute)

```bash
# Recommended: install from npm (installs both binaries)
npm install -g mcp-ssh-manager

# Available commands after install:
# - mcp-ssh-manager
# - ssh-manager
```

From source (alternative):
```bash
git clone https://github.com/brandonsparkles/mcp-ssh-manager.git
cd mcp-ssh-manager
npm install
npm link
```

## 2️⃣ Add Your First Server (2 minutes)

```bash
# Add with guided prompts
ssh-manager server add
```

Enter:
- Name: `myserver` (letters/digits/underscore only)
- Host: `your.server.com`
- Username: `yourusername`
- Port: `22`
- Choose authentication method (SSH key recommended)

## 3️⃣ Install to Claude Code (1 minute)

```bash
# If installed globally:
claude mcp add ssh-manager mcp-ssh-manager

# If running from source:
claude mcp add ssh-manager node /absolute/path/to/mcp-ssh-manager/src/index.js
```

## 4️⃣ Test It! (1 minute)

In Claude Code:
```bash
claude
```

Try these commands:
```
"List my SSH servers"
"Execute 'hostname' on myserver"
"Run 'ls -la' on myserver"
```

## 🎉 That's it

You're now connected to your server through Claude Code!

## 📝 Common Commands

```bash
ssh-manager                    # Interactive menu
ssh-manager server list        # List servers
ssh-manager ssh myserver       # Quick SSH
ssh-manager server test        # Test connections
ssh-manager sync push myserver ./app /var/www/  # Upload files
```

## 💡 Pro Tips

1. **No env var required by default**:
   - CLI + MCP both use `~/.ssh-manager/.env` automatically.

2. **Use a custom config path (optional)**:
   ```bash
   # CLI .env override
   export SSH_MANAGER_ENV="/path/to/servers.env"

   # MCP .env override
   export SSH_ENV_PATH="/path/to/servers.env"

   # TOML override (Codex-style config)
   export SSH_CONFIG_PATH="/path/to/ssh-config.toml"
   ```

3. **Config precedence**:
   - Environment variables > `.env` > TOML
   - Set `PREFER_TOML_CONFIG=true` to skip loading `.env`.

4. **Create shortcuts**:
   ```bash
   alias ssm="ssh-manager"
   alias ssm-list="ssh-manager server list"
   ```

Need help? Run `ssh-manager --help`