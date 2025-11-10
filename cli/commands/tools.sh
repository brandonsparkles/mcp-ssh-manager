#!/bin/bash
# Tool management commands for ssh-manager CLI

# Tool configuration file location
TOOLS_CONFIG="${HOME}/.ssh-manager/tools-config.json"

# Tool group definitions (matching src/tool-registry.js)
get_tool_count() {
    case "$1" in
        core) echo "5" ;;
        sessions) echo "4" ;;
        monitoring) echo "6" ;;
        backup) echo "4" ;;
        database) echo "4" ;;
        advanced) echo "14" ;;
        *) echo "0" ;;
    esac
}

get_tool_description() {
    case "$1" in
        core) echo "Essential SSH operations (list, execute, upload, download, sync)" ;;
        sessions) echo "Persistent SSH sessions with state management" ;;
        monitoring) echo "System health checks, service monitoring, process management, and alerts" ;;
        backup) echo "Automated backup and restore for databases and files" ;;
        database) echo "Database operations (MySQL, PostgreSQL, MongoDB)" ;;
        advanced) echo "Advanced features (deployment, sudo, tunnels, groups, aliases, hooks, profiles)" ;;
        *) echo "" ;;
    esac
}

# Main tools command router
cmd_tools() {
    local action="$1"
    shift || true

    case "$action" in
        list|ls)
            cmd_tools_list "$@"
            ;;
        enable|on)
            cmd_tools_enable "$@"
            ;;
        disable|off)
            cmd_tools_disable "$@"
            ;;
        reset)
            cmd_tools_reset "$@"
            ;;
        configure|config|setup)
            cmd_tools_configure "$@"
            ;;
        show|status)
            cmd_tools_show "$@"
            ;;
        export-claude|export)
            cmd_tools_export_claude "$@"
            ;;
        "")
            print_error "Missing action"
            echo ""
            echo "Usage: ssh-manager tools <action>"
            echo ""
            echo "Actions:"
            echo "  list              Show all tools and their status"
            echo "  configure         Interactive configuration wizard"
            echo "  enable <group>    Enable a tool group"
            echo "  disable <group>   Disable a tool group"
            echo "  reset             Reset to default (all tools enabled)"
            echo "  export-claude     Export Claude Code auto-approval config"
            return 1
            ;;
        *)
            print_error "Unknown tools command: $action"
            echo ""
            echo "Available commands: list, configure, enable, disable, reset, export-claude"
            return 1
            ;;
    esac
}

# List all tools with status
cmd_tools_list() {
    print_header "MCP Tools Configuration"

    if [ ! -f "$TOOLS_CONFIG" ]; then
        print_info "No tool configuration found"
        echo ""
        echo "${GRAY}Default: All 37 tools enabled${NC}"
        echo ""
        print_info "Run ${CYAN}ssh-manager tools configure${NC} to customize and reduce context usage"
        return 0
    fi

    # Read configuration
    local mode=$(jq -r '.mode // "all"' "$TOOLS_CONFIG" 2>/dev/null || echo "all")
    local enabled_count=0
    local total_count=37

    # Calculate enabled count
    case "$mode" in
        all)
            enabled_count=37
            ;;
        minimal)
            enabled_count=5
            ;;
        custom)
            # Count enabled tools per group
            for group in core sessions monitoring backup database advanced; do
                local group_enabled=$(jq -r ".groups.$group.enabled // true" "$TOOLS_CONFIG" 2>/dev/null || echo "true")
                if [ "$group_enabled" = "true" ]; then
                    enabled_count=$((enabled_count + TOOL_GROUP_COUNTS[$group]))
                fi
            done
            ;;
    esac

    echo ""
    echo "  ${BOLD}Mode:${NC} ${CYAN}$mode${NC}"
    echo "  ${BOLD}Enabled:${NC} ${enabled_count}/${total_count} tools"
    echo "  ${BOLD}Config:${NC} ${GRAY}$TOOLS_CONFIG${NC}"
    echo ""

    print_subheader "Tool Groups"
    echo ""

    # Print header
    printf "${BOLD}%-12s %-10s %-8s %s${NC}\n" "GROUP" "STATUS" "TOOLS" "DESCRIPTION"
    printf "${GRAY}%-12s %-10s %-8s %s${NC}\n" "────────────" "──────────" "────────" "─────────────────────────────────────────"

    # Print each group
    for group in core sessions monitoring backup database advanced; do
        local enabled="true"
        local status_icon="${GREEN}●${NC}"
        local status_text="${GREEN}enabled${NC}"

        if [ -f "$TOOLS_CONFIG" ]; then
            case "$mode" in
                all)
                    enabled="true"
                    ;;
                minimal)
                    if [ "$group" != "core" ]; then
                        enabled="false"
                        status_icon="${GRAY}○${NC}"
                        status_text="${GRAY}disabled${NC}"
                    fi
                    ;;
                custom)
                    enabled=$(jq -r ".groups.$group.enabled // true" "$TOOLS_CONFIG" 2>/dev/null || echo "true")
                    if [ "$enabled" != "true" ]; then
                        status_icon="${GRAY}○${NC}"
                        status_text="${GRAY}disabled${NC}"
                    fi
                    ;;
            esac
        fi

        local count="$(get_tool_count "$group")"
        local desc="$(get_tool_description "$group")"

        printf "%-12s %s %-8s %-8s %s\n" "$group" "$status_icon" "$status_text" "$count" "$desc"
    done

    echo ""

    # Show tips
    if [ "$mode" = "all" ]; then
        print_info "${LIGHTBULB} Tip: Switch to ${CYAN}minimal${NC} mode to reduce context usage by 92%"
        echo "        Run: ${CYAN}ssh-manager tools configure${NC}"
    elif [ "$mode" = "minimal" ]; then
        print_success "${CHECK} Optimized! Using only 5 core tools (saves ~40k tokens in Claude Code)"
        echo ""
        echo "        To enable more tools: ${CYAN}ssh-manager tools enable <group>${NC}"
    fi

    echo ""
}

# Show current configuration details
cmd_tools_show() {
    if [ ! -f "$TOOLS_CONFIG" ]; then
        print_error "No configuration file found"
        echo ""
        echo "Run ${CYAN}ssh-manager tools configure${NC} to create one"
        return 1
    fi

    print_header "Tool Configuration Details"
    echo ""

    cat "$TOOLS_CONFIG" | jq '.' 2>/dev/null || {
        print_error "Failed to parse configuration file"
        return 1
    }

    echo ""
}

# Enable a tool group
cmd_tools_enable() {
    local group="$1"

    if [ -z "$group" ]; then
        print_error "Usage: ssh-manager tools enable <group>"
        echo ""
        echo "Available groups: core, sessions, monitoring, backup, database, advanced"
        return 1
    fi

    # Validate group name
    if [[ ! "$group" =~ ^(core|sessions|monitoring|backup|database|advanced)$ ]]; then
        print_error "Unknown group: $group"
        echo ""
        echo "Available groups: core, sessions, monitoring, backup, database, advanced"
        return 1
    fi

    # Ensure config file exists
    if [ ! -f "$TOOLS_CONFIG" ]; then
        # Create default config in custom mode
        mkdir -p "$(dirname "$TOOLS_CONFIG")"
        cat > "$TOOLS_CONFIG" <<EOF
{
  "version": "1.0",
  "mode": "custom",
  "groups": {
    "core": { "enabled": true },
    "sessions": { "enabled": false },
    "monitoring": { "enabled": false },
    "backup": { "enabled": false },
    "database": { "enabled": false },
    "advanced": { "enabled": false }
  },
  "tools": {},
  "_comment": "Tool configuration created by ssh-manager tools enable"
}
EOF
    fi

    # Update mode to custom if it's all
    local current_mode=$(jq -r '.mode // "all"' "$TOOLS_CONFIG")
    if [ "$current_mode" = "all" ]; then
        # Initialize all groups as enabled when coming from 'all' mode
        jq '.mode = "custom" | .groups.core.enabled = true | .groups.sessions.enabled = true | .groups.monitoring.enabled = true | .groups.backup.enabled = true | .groups.database.enabled = true | .groups.advanced.enabled = true' "$TOOLS_CONFIG" > "$TOOLS_CONFIG.tmp"
        mv "$TOOLS_CONFIG.tmp" "$TOOLS_CONFIG"
    elif [ "$current_mode" = "minimal" ]; then
        # Initialize from minimal
        jq '.mode = "custom" | .groups.core.enabled = true | .groups.sessions.enabled = false | .groups.monitoring.enabled = false | .groups.backup.enabled = false | .groups.database.enabled = false | .groups.advanced.enabled = false' "$TOOLS_CONFIG" > "$TOOLS_CONFIG.tmp"
        mv "$TOOLS_CONFIG.tmp" "$TOOLS_CONFIG"
    fi

    # Enable the group
    jq ".groups.$group.enabled = true" "$TOOLS_CONFIG" > "$TOOLS_CONFIG.tmp"
    mv "$TOOLS_CONFIG.tmp" "$TOOLS_CONFIG"

    local count="$(get_tool_count "$group")"
    print_success "Enabled ${CYAN}$group${NC} group (${count} tools)"
    echo ""
    print_warning "Restart MCP server for changes to take effect:"
    echo "  - Restart Claude Code, or"
    echo "  - Run: ${CYAN}claude mcp restart${NC}"
}

# Disable a tool group
cmd_tools_disable() {
    local group="$1"

    if [ -z "$group" ]; then
        print_error "Usage: ssh-manager tools disable <group>"
        echo ""
        echo "Available groups: sessions, monitoring, backup, database, advanced"
        echo "${GRAY}Note: 'core' group cannot be disabled${NC}"
        return 1
    fi

    # Validate group name
    if [[ ! "$group" =~ ^(sessions|monitoring|backup|database|advanced)$ ]]; then
        if [ "$group" = "core" ]; then
            print_error "Cannot disable 'core' group (required for basic functionality)"
        else
            print_error "Unknown group: $group"
            echo ""
            echo "Available groups: sessions, monitoring, backup, database, advanced"
        fi
        return 1
    fi

    # Ensure config file exists
    if [ ! -f "$TOOLS_CONFIG" ]; then
        mkdir -p "$(dirname "$TOOLS_CONFIG")"
        cat > "$TOOLS_CONFIG" <<EOF
{
  "version": "1.0",
  "mode": "custom",
  "groups": {
    "core": { "enabled": true },
    "sessions": { "enabled": true },
    "monitoring": { "enabled": true },
    "backup": { "enabled": true },
    "database": { "enabled": true },
    "advanced": { "enabled": true }
  },
  "tools": {},
  "_comment": "Tool configuration created by ssh-manager tools disable"
}
EOF
    fi

    # Update mode to custom if needed
    local current_mode=$(jq -r '.mode // "all"' "$TOOLS_CONFIG")
    if [ "$current_mode" = "all" ]; then
        jq '.mode = "custom" | .groups.core.enabled = true | .groups.sessions.enabled = true | .groups.monitoring.enabled = true | .groups.backup.enabled = true | .groups.database.enabled = true | .groups.advanced.enabled = true' "$TOOLS_CONFIG" > "$TOOLS_CONFIG.tmp"
        mv "$TOOLS_CONFIG.tmp" "$TOOLS_CONFIG"
    fi

    # Disable the group
    jq ".groups.$group.enabled = false" "$TOOLS_CONFIG" > "$TOOLS_CONFIG.tmp"
    mv "$TOOLS_CONFIG.tmp" "$TOOLS_CONFIG"

    local count="$(get_tool_count "$group")"
    print_success "Disabled ${CYAN}$group${NC} group (${count} tools)"
    echo ""
    print_warning "Restart MCP server for changes to take effect:"
    echo "  - Restart Claude Code, or"
    echo "  - Run: ${CYAN}claude mcp restart${NC}"
}

# Reset configuration to defaults
cmd_tools_reset() {
    if [ -f "$TOOLS_CONFIG" ]; then
        print_warning "This will delete your tool configuration and enable all 37 tools"
        echo ""
        if prompt_yes_no "Continue?" "n"; then
            rm -f "$TOOLS_CONFIG"
            print_success "Tool configuration reset to defaults (all tools enabled)"
            echo ""
            print_info "Restart Claude Code for changes to take effect"
        else
            print_info "Cancelled"
        fi
    else
        print_info "No configuration file found (already using defaults)"
    fi
}

# Interactive configuration wizard
cmd_tools_configure() {
    print_header "Tool Configuration Wizard"

    echo ""
    echo "MCP SSH Manager has ${BOLD}37 tools${NC} organized into ${BOLD}6 groups${NC}:"
    echo ""

    for group in core sessions monitoring backup database advanced; do
        local count="$(get_tool_count "$group")"
        local desc="$(get_tool_description "$group")"
        printf "  ${CYAN}%-12s${NC} (%-2d tools) - %s\n" "$group" "$count" "$desc"
    done

    echo ""
    echo "Choose configuration mode:"
    echo ""
    echo "  ${GREEN}1) All tools${NC} (recommended for most users)"
    echo "     ├─ All 37 tools enabled"
    echo "     ├─ Full feature set available"
    echo "     └─ Uses ~43k tokens in Claude Code"
    echo ""
    echo "  ${YELLOW}2) Minimal${NC} (lightweight, core functionality only)"
    echo "     ├─ Only 5 core tools enabled"
    echo "     ├─ Reduces context usage by 92%"
    echo "     └─ Uses ~3.5k tokens in Claude Code"
    echo ""
    echo "  ${CYAN}3) Custom${NC} (choose which groups to enable)"
    echo "     ├─ Interactive group selection"
    echo "     ├─ Fine-tune for your workflow"
    echo "     └─ Balances features and context usage"
    echo ""

    read -p "Choose [1-3]: " mode_choice

    # Create config directory
    mkdir -p "$(dirname "$TOOLS_CONFIG")"

    case "$mode_choice" in
        2)
            # Minimal mode
            cat > "$TOOLS_CONFIG" <<EOF
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
  "tools": {},
  "_comment": "Minimal mode - only 5 core tools enabled"
}
EOF
            echo ""
            print_success "Configuration saved: ${YELLOW}Minimal mode${NC} (5 tools)"
            echo ""
            echo "  ${GREEN}Context savings:${NC} ~40k tokens (92% reduction)"
            echo "  ${GREEN}Enabled tools:${NC} ssh_list_servers, ssh_execute, ssh_upload, ssh_download, ssh_sync"
            ;;

        3)
            # Custom mode - interactive
            echo ""
            print_subheader "Group Selection"
            echo ""
            echo "${BOLD}Core${NC} group is always enabled. Choose additional groups:"
            echo ""

            local sessions="false"
            local monitoring="false"
            local backup="false"
            local database="false"
            local advanced="false"

            if prompt_yes_no "Enable ${CYAN}sessions${NC} group? (4 tools - persistent SSH sessions)" "n"; then
                sessions="true"
            fi

            if prompt_yes_no "Enable ${CYAN}monitoring${NC} group? (6 tools - health checks, service monitoring)" "n"; then
                monitoring="true"
            fi

            if prompt_yes_no "Enable ${CYAN}backup${NC} group? (4 tools - database and file backups)" "n"; then
                backup="true"
            fi

            if prompt_yes_no "Enable ${CYAN}database${NC} group? (4 tools - MySQL, PostgreSQL, MongoDB)" "n"; then
                database="true"
            fi

            if prompt_yes_no "Enable ${CYAN}advanced${NC} group? (14 tools - deployment, sudo, tunnels, etc)" "n"; then
                advanced="true"
            fi

            cat > "$TOOLS_CONFIG" <<EOF
{
  "version": "1.0",
  "mode": "custom",
  "groups": {
    "core": { "enabled": true },
    "sessions": { "enabled": $sessions },
    "monitoring": { "enabled": $monitoring },
    "backup": { "enabled": $backup },
    "database": { "enabled": $database },
    "advanced": { "enabled": $advanced }
  },
  "tools": {},
  "_comment": "Custom configuration created by wizard"
}
EOF

            # Count enabled tools
            local enabled_count=5  # core
            [ "$sessions" = "true" ] && enabled_count=$((enabled_count + 4))
            [ "$monitoring" = "true" ] && enabled_count=$((enabled_count + 6))
            [ "$backup" = "true" ] && enabled_count=$((enabled_count + 4))
            [ "$database" = "true" ] && enabled_count=$((enabled_count + 4))
            [ "$advanced" = "true" ] && enabled_count=$((enabled_count + 14))

            echo ""
            print_success "Configuration saved: ${CYAN}Custom mode${NC} ($enabled_count tools enabled)"
            ;;

        *)
            # All tools (default)
            cat > "$TOOLS_CONFIG" <<EOF
{
  "version": "1.0",
  "mode": "all",
  "groups": {
    "core": { "enabled": true },
    "sessions": { "enabled": true },
    "monitoring": { "enabled": true },
    "backup": { "enabled": true },
    "database": { "enabled": true },
    "advanced": { "enabled": true }
  },
  "tools": {},
  "_comment": "All tools enabled (default configuration)"
}
EOF
            echo ""
            print_success "Configuration saved: ${GREEN}All tools mode${NC} (37 tools)"
            ;;
    esac

    echo ""
    echo "  ${BOLD}Config file:${NC} ${GRAY}$TOOLS_CONFIG${NC}"
    echo ""
    print_warning "Restart MCP server for changes to take effect:"
    echo "  ${ARROW} Option 1: Restart Claude Code application"
    echo "  ${ARROW} Option 2: Run ${CYAN}claude mcp restart${NC}"
    echo ""

    # Offer to export auto-approval config
    if prompt_yes_no "Generate Claude Code auto-approval configuration?" "y"; then
        cmd_tools_export_claude
    fi
}

# Export Claude Code auto-approval configuration
cmd_tools_export_claude() {
    if [ ! -f "$TOOLS_CONFIG" ]; then
        print_error "No tool configuration found"
        echo ""
        echo "Run ${CYAN}ssh-manager tools configure${NC} first"
        return 1
    fi

    print_header "Claude Code Auto-Approval Configuration"
    echo ""

    # Read mode
    local mode=$(jq -r '.mode // "all"' "$TOOLS_CONFIG")

    # Build tool list
    local tools=()

    case "$mode" in
        all)
            # All 37 tools
            tools=("ssh_list_servers" "ssh_execute" "ssh_upload" "ssh_download" "ssh_sync"
                   "ssh_session_start" "ssh_session_send" "ssh_session_list" "ssh_session_close"
                   "ssh_health_check" "ssh_service_status" "ssh_process_manager" "ssh_monitor" "ssh_tail" "ssh_alert_setup"
                   "ssh_backup_create" "ssh_backup_list" "ssh_backup_restore" "ssh_backup_schedule"
                   "ssh_db_dump" "ssh_db_import" "ssh_db_list" "ssh_db_query"
                   "ssh_deploy" "ssh_execute_sudo" "ssh_alias" "ssh_command_alias" "ssh_hooks" "ssh_profile"
                   "ssh_connection_status" "ssh_tunnel_create" "ssh_tunnel_list" "ssh_tunnel_close"
                   "ssh_key_manage" "ssh_execute_group" "ssh_group_manage" "ssh_history")
            ;;
        minimal)
            tools=("ssh_list_servers" "ssh_execute" "ssh_upload" "ssh_download" "ssh_sync")
            ;;
        custom)
            # Core (always enabled)
            tools=("ssh_list_servers" "ssh_execute" "ssh_upload" "ssh_download" "ssh_sync")

            # Check each group
            if [ "$(jq -r '.groups.sessions.enabled // false' "$TOOLS_CONFIG")" = "true" ]; then
                tools+=("ssh_session_start" "ssh_session_send" "ssh_session_list" "ssh_session_close")
            fi

            if [ "$(jq -r '.groups.monitoring.enabled // false' "$TOOLS_CONFIG")" = "true" ]; then
                tools+=("ssh_health_check" "ssh_service_status" "ssh_process_manager" "ssh_monitor" "ssh_tail" "ssh_alert_setup")
            fi

            if [ "$(jq -r '.groups.backup.enabled // false' "$TOOLS_CONFIG")" = "true" ]; then
                tools+=("ssh_backup_create" "ssh_backup_list" "ssh_backup_restore" "ssh_backup_schedule")
            fi

            if [ "$(jq -r '.groups.database.enabled // false' "$TOOLS_CONFIG")" = "true" ]; then
                tools+=("ssh_db_dump" "ssh_db_import" "ssh_db_list" "ssh_db_query")
            fi

            if [ "$(jq -r '.groups.advanced.enabled // false' "$TOOLS_CONFIG")" = "true" ]; then
                tools+=("ssh_deploy" "ssh_execute_sudo" "ssh_alias" "ssh_command_alias" "ssh_hooks" "ssh_profile"
                        "ssh_connection_status" "ssh_tunnel_create" "ssh_tunnel_list" "ssh_tunnel_close"
                        "ssh_key_manage" "ssh_execute_group" "ssh_group_manage" "ssh_history")
            fi
            ;;
    esac

    # Generate JSON
    echo "Add this to your ${CYAN}~/.config/claude-code/claude_code_config.json${NC}:"
    echo ""
    echo "${GRAY}────────────────────────────────────────────────────────────${NC}"
    echo "{"
    echo "  \"autoApprove\": {"
    echo "    \"tools\": ["

    local first=true
    for tool in "${tools[@]}"; do
        if [ "$first" = true ]; then
            first=false
        else
            echo ","
        fi
        printf "      \"mcp__ssh-manager__${tool}\""
    done

    echo ""
    echo "    ]"
    echo "  }"
    echo "}"
    echo "${GRAY}────────────────────────────────────────────────────────────${NC}"
    echo ""
    print_info "Copy the ${CYAN}autoApprove${NC} section above into your Claude Code config"
    echo ""
    echo "  ${BOLD}Config location:${NC} ~/.config/claude-code/claude_code_config.json"
    echo "  ${BOLD}Enabled tools:${NC} ${#tools[@]} tools will be auto-approved"
    echo ""
}
