#!/bin/bash
# Configuration management library for ssh-manager CLI

# Configuration paths
export SSH_MANAGER_HOME="${SSH_MANAGER_HOME:-$HOME/.ssh-manager}"
export SSH_MANAGER_CONFIG="$SSH_MANAGER_HOME/config.json"

# Resolve .env path - handle both direct and symlinked execution
if [ -z "$SSH_MANAGER_ENV" ]; then
    if [ -n "$SCRIPT_DIR" ]; then
        # Called from main ssh-manager script
        SSH_MANAGER_ENV="$(dirname "$SCRIPT_DIR")/.env"
    else
        # Called directly - need to resolve path ourselves
        if [ -L "$0" ]; then
            REAL_PATH="$(readlink -f "$0" 2>/dev/null || readlink "$0")"
        else
            REAL_PATH="$0"
        fi
        REAL_DIR="$(cd "$(dirname "$REAL_PATH")" && pwd)"
        SSH_MANAGER_ENV="$(dirname "$(dirname "$REAL_DIR")")/.env"
    fi
    export SSH_MANAGER_ENV
fi

export SSH_MANAGER_ALIASES="$SSH_MANAGER_HOME/aliases.json"

# Ensure config directory exists
init_config() {
    if [ ! -d "$SSH_MANAGER_HOME" ]; then
        mkdir -p "$SSH_MANAGER_HOME"
        print_info "Created config directory: $SSH_MANAGER_HOME"
    fi
    
    # Create default config if not exists
    if [ ! -f "$SSH_MANAGER_CONFIG" ]; then
        cat > "$SSH_MANAGER_CONFIG" <<EOF
{
  "default_editor": "${EDITOR:-nano}",
  "default_shell": "${SHELL:-/bin/bash}",
  "history_file": "$SSH_MANAGER_HOME/history",
  "log_level": "info",
  "color_output": true
}
EOF
        print_info "Created default config: $SSH_MANAGER_CONFIG"
    fi
}

# Load configuration value
get_config() {
    local key="$1"
    local default="$2"
    
    if [ -f "$SSH_MANAGER_CONFIG" ] && command -v jq >/dev/null 2>&1; then
        local value=$(jq -r ".$key // null" "$SSH_MANAGER_CONFIG" 2>/dev/null)
        if [ "$value" != "null" ]; then
            echo "$value"
        else
            echo "$default"
        fi
    else
        echo "$default"
    fi
}

# Set configuration value
set_config() {
    local key="$1"
    local value="$2"
    
    if command -v jq >/dev/null 2>&1; then
        local temp=$(mktemp)
        jq ".$key = \"$value\"" "$SSH_MANAGER_CONFIG" > "$temp" && mv "$temp" "$SSH_MANAGER_CONFIG"
        print_success "Updated config: $key = $value"
    else
        print_error "jq is required for config management"
        return 1
    fi
}

# Load servers from .env file
load_servers() {
    local servers=()
    
    if [ ! -f "$SSH_MANAGER_ENV" ]; then
        return 1
    fi
    
    # Parse .env file for server definitions
    while IFS= read -r line; do
        if [[ "$line" =~ ^SSH_SERVER_(.+)_HOST= ]]; then
            local server_name="${BASH_REMATCH[1]}"
            # Convert to lowercase
            server_name=$(echo "$server_name" | tr '[:upper:]' '[:lower:]')
            servers+=("$server_name")
        fi
    done < "$SSH_MANAGER_ENV"
    
    # Remove duplicates
    printf '%s\n' "${servers[@]}" | sort -u
}

# Get server configuration
get_server_config() {
    local server="$1"
    local field="$2"
    local server_upper="$(echo "$server" | tr '[:lower:]' '[:upper:]')"
    
    if [ ! -f "$SSH_MANAGER_ENV" ]; then
        return 1
    fi
    
    local field_upper="$(echo "$field" | tr '[:lower:]' '[:upper:]')"
    local key="SSH_SERVER_${server_upper}_${field_upper}"
    grep "^${key}=" "$SSH_MANAGER_ENV" 2>/dev/null | cut -d'=' -f2- | tr -d '"'
}

# Add server to .env
add_server_to_env() {
    local name="$1"
    local host="$2"
    local user="$3"
    local auth_type="$4"
    local auth_value="$5"
    local port="${6:-22}"
    local description="${7:-}"
    
    local name_upper="$(echo "$name" | tr '[:lower:]' '[:upper:]')"
    
    # Check if server already exists
    if grep -q "^SSH_SERVER_${name_upper}_HOST=" "$SSH_MANAGER_ENV" 2>/dev/null; then
        print_error "Server '$name' already exists"
        return 1
    fi
    
    # Backup .env file
    cp "$SSH_MANAGER_ENV" "$SSH_MANAGER_ENV.bak"
    
    # Add server configuration
    {
        echo ""
        echo "# Server: $name"
        echo "SSH_SERVER_${name_upper}_HOST=$host"
        echo "SSH_SERVER_${name_upper}_USER=$user"
        echo "SSH_SERVER_${name_upper}_PORT=$port"
        
        if [ "$auth_type" = "password" ]; then
            echo "SSH_SERVER_${name_upper}_PASSWORD=$auth_value"
        else
            echo "SSH_SERVER_${name_upper}_KEYPATH=$auth_value"
        fi
        
        if [ -n "$description" ]; then
            echo "SSH_SERVER_${name_upper}_DESCRIPTION=\"$description\""
        fi
    } >> "$SSH_MANAGER_ENV"
    
    print_success "Server '$name' added successfully"
}

# Remove server from .env
remove_server_from_env() {
    local name="$1"
    local name_upper="$(echo "$name" | tr '[:lower:]' '[:upper:]')"
    
    if ! grep -q "^SSH_SERVER_${name_upper}_HOST=" "$SSH_MANAGER_ENV" 2>/dev/null; then
        print_error "Server '$name' not found"
        return 1
    fi
    
    # Backup .env file
    cp "$SSH_MANAGER_ENV" "$SSH_MANAGER_ENV.bak"
    
    # Remove all lines for this server
    local temp=$(mktemp)
    grep -v "^SSH_SERVER_${name_upper}_" "$SSH_MANAGER_ENV" > "$temp"
    mv "$temp" "$SSH_MANAGER_ENV"
    
    print_success "Server '$name' removed successfully"
}

# Test SSH connection
test_ssh_connection() {
    local server="$1"
    local host=$(get_server_config "$server" "HOST")
    local user=$(get_server_config "$server" "USER")
    local port=$(get_server_config "$server" "PORT")
    local keypath=$(get_server_config "$server" "KEYPATH")
    local password=$(get_server_config "$server" "PASSWORD")
    
    port=${port:-22}
    
    if [ -z "$host" ] || [ -z "$user" ]; then
        print_error "Server '$server' not found or incomplete configuration"
        return 1
    fi
    
    print_info "Testing connection to $server ($user@$host:$port)..."
    
    local ssh_opts="-o ConnectTimeout=5 -o StrictHostKeyChecking=no"
    
    if [ -n "$keypath" ]; then
        ssh_opts="$ssh_opts -i $keypath"
    fi
    
    if [ -n "$password" ]; then
        # Use sshpass if available
        if command -v sshpass >/dev/null 2>&1; then
            sshpass -p "$password" ssh $ssh_opts -p "$port" "$user@$host" "echo 'Connection successful'" 2>/dev/null
        else
            print_warning "sshpass not installed, cannot test password authentication"
            return 1
        fi
    else
        ssh $ssh_opts -p "$port" "$user@$host" "echo 'Connection successful'" 2>/dev/null
    fi
    
    if [ $? -eq 0 ]; then
        print_success "Connection successful"
        return 0
    else
        print_error "Connection failed"
        return 1
    fi
}

# Validate server name
validate_server_name() {
    local name="$1"
    
    # Check if name is empty
    if [ -z "$name" ]; then
        print_error "Server name cannot be empty"
        return 1
    fi
    
    # Check for invalid characters
    if ! [[ "$name" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        print_error "Server name can only contain letters, numbers, underscore and hyphen"
        return 1
    fi
    
    # Check if name starts with a letter
    if ! [[ "$name" =~ ^[a-zA-Z] ]]; then
        print_error "Server name must start with a letter"
        return 1
    fi
    
    return 0
}

# Check dependencies
check_dependencies() {
    local missing=()
    
    # Check for required commands
    for cmd in ssh rsync; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            missing+=("$cmd")
        fi
    done
    
    # Check for optional but recommended commands
    local optional=()
    for cmd in jq sshpass; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            optional+=("$cmd")
        fi
    done
    
    if [ ${#missing[@]} -gt 0 ]; then
        print_error "Missing required dependencies: ${missing[*]}"
        print_info "Please install them and try again"
        return 1
    fi
    
    if [ ${#optional[@]} -gt 0 ]; then
        print_warning "Missing optional dependencies: ${optional[*]}"
        print_info "Some features may not work without them"
    fi
    
    return 0
}