# SSH Manager CLI

A simple, powerful, and fast Bash-based CLI for managing SSH servers.

## Features

- 🚀 **Fast**: Pure Bash, no runtime dependencies
- 🎨 **Beautiful**: Colored output with emojis
- 📦 **Simple**: Single command for all operations
- 🔧 **Powerful**: Tunnels, sync, monitoring, and more
- 🔌 **Integrated**: Works with MCP SSH Manager server

## Installation

### Quick Install

```bash
cd cli
./install.sh
```

### Manual Install

```bash
# Copy CLI to your home
cp -r cli ~/.ssh-manager-cli

# Create symlink
sudo ln -s ~/.ssh-manager-cli/ssh-manager /usr/local/bin/ssh-manager

# Make executable
chmod +x ~/.ssh-manager-cli/ssh-manager
```

### Dependencies

**Required:**
- `bash` (4.0+)
- `ssh`

**Optional:**
- `rsync` - Required only for `ssh-manager sync push|pull`
- `jq` - For JSON configuration management
- `sshpass` - For password authentication testing

## Usage

### Current Direct Commands

```bash
ssh-manager server ...
ssh-manager ssh <server>         # alias: connect
ssh-manager exec <server> "<cmd>"
ssh-manager sync <push|pull> ...
ssh-manager tunnel <create|list> ...
ssh-manager tools ...
ssh-manager config <edit|show|init>
```

### Server Management

```bash
# Add a new server interactively
ssh-manager server add

# List all servers
ssh-manager server list

# Test connection
ssh-manager server test prod1

# Show server details
ssh-manager server show prod1

# Remove a server
ssh-manager server remove prod1

# Edit configuration
ssh-manager server edit
```

### Quick SSH Connection

```bash
# Connect to a server
ssh-manager ssh prod1
```

### File Synchronization

```bash
# Push files to server
ssh-manager sync push prod1 ./app /var/www/app

# Pull files from server
ssh-manager sync pull prod1 /var/log/app.log ./logs/
```

### SSH Tunnels

```bash
# Local port forwarding (access remote service locally)
ssh-manager tunnel create prod1 local 3307:localhost:3306

# Remote port forwarding (expose local service)
ssh-manager tunnel create prod1 remote 8080:localhost:8080

# SOCKS proxy
ssh-manager tunnel create prod1 dynamic 1080

# List active tunnels
ssh-manager tunnel list
```

### Execute Commands

```bash
# Run command on server
ssh-manager exec prod1 "uptime"

# Run complex commands
ssh-manager exec prod1 "df -h | grep /var"
```

## Configuration

### Server Configuration (.env)

By default, servers are stored in `~/.ssh-manager/.env` (or `SSH_MANAGER_ENV` if set):

```env
# Production Server
SSH_SERVER_PROD1_HOST=192.168.1.100
SSH_SERVER_PROD1_USER=admin
SSH_SERVER_PROD1_PORT=22
SSH_SERVER_PROD1_KEYPATH=~/.ssh/id_rsa
SSH_SERVER_PROD1_DESCRIPTION="Production Web Server"

# Database Server
SSH_SERVER_DB1_HOST=192.168.1.101
SSH_SERVER_DB1_USER=dbadmin
SSH_SERVER_DB1_PASSWORD=secret
SSH_SERVER_DB1_DEFAULT_DIR=/var/lib/mysql
```

### CLI Configuration

Configuration stored in `~/.ssh-manager/config.json`:

```json
{
  "default_editor": "nano",
  "default_shell": "/bin/bash",
  "color_output": true,
  "log_level": "info"
}
```

## Examples

### Database Tunnel

Access remote MySQL locally:

```bash
# Create tunnel
ssh-manager tunnel create prod1 local 3307:localhost:3306

# Connect to MySQL
mysql -h localhost -P 3307 -u root -p
```

### Deploy Application

```bash
# Sync application files
ssh-manager sync push prod1 ./dist/ /var/www/app/

# Restart service
ssh-manager exec prod1 "sudo systemctl restart app"

# Check status
ssh-manager exec prod1 "systemctl status app"
```

### Backup Logs

```bash
# Create backup directory
mkdir -p ./backups/$(date +%Y%m%d)

# Pull logs
ssh-manager sync pull prod1 /var/log/app/ ./backups/$(date +%Y%m%d)/
```

## Advanced Usage

### Using with MCP Server

The CLI works seamlessly with the MCP SSH Manager server:

```bash
# Use CLI for configuration
ssh-manager server add

# Use MCP tools in Claude for operations
# The same .env file is shared
```

### Scripting

```bash
#!/bin/bash
# Deploy script using ssh-manager

SERVERS=(prod1 prod2 prod3)

for server in "${SERVERS[@]}"; do
    echo "Deploying to $server..."
    ssh-manager sync push $server ./dist/ /var/www/app/
    ssh-manager exec $server "sudo systemctl restart app"
done
```

### Aliases

Create shell aliases for common operations:

```bash
# Add to ~/.bashrc or ~/.zshrc
alias sml='ssh-manager server list'
alias smt='ssh-manager server test'
alias smc='ssh-manager ssh'

# Usage
sml          # List servers
smt prod1    # Test prod1
smc prod1    # Connect to prod1
```

## Comparison with Python CLI

| Feature | Bash CLI | Python CLI |
|---------|----------|------------|
| Speed | ⚡ Very fast | 🐢 Slower startup |
| Dependencies | ✅ None (bash/ssh) | ❌ Python packages |
| Installation | ✅ Simple copy | ❌ pip install |
| Windows | ❌ WSL needed | ✅ Native |
| Features | ✅ All essential | ✅ All features |

## Troubleshooting

### Command not found

```bash
# Check if installed
which ssh-manager

# Add to PATH if needed
export PATH="$PATH:/usr/local/bin"
```

### Permission denied

```bash
# Make executable
chmod +x ~/.ssh-manager-cli/ssh-manager

# Install with sudo if needed
sudo ./install.sh
```

### Missing dependencies

```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq sshpass

# RHEL/CentOS
sudo yum install jq sshpass
```

## Contributing

The CLI is part of the MCP SSH Manager project. Contributions welcome!

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - See LICENSE file for details