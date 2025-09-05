#!/bin/bash

echo "🔧 Test SSH Tunnels"
echo "==================="
echo ""
echo "SSH tunnels allow secure port forwarding and SOCKS proxy creation"
echo "for accessing remote services and networks."
echo ""
echo "📋 Test Commands for SSH Tunnels:"
echo "=================================="
echo ""
echo "# 1. Local Port Forwarding"
echo "# Access remote service (e.g., database) locally"
echo 'ssh_tunnel_create server:"prod1" type:"local" localPort:3307 remoteHost:"localhost" remotePort:3306'
echo '# Now you can access remote MySQL on localhost:3307'
echo ""
echo "# 2. Remote Port Forwarding"  
echo "# Expose local service to remote server"
echo 'ssh_tunnel_create server:"prod1" type:"remote" localPort:8080 remoteHost:"0.0.0.0" remotePort:8080'
echo '# Remote users can now access your local service'
echo ""
echo "# 3. Dynamic Port Forwarding (SOCKS Proxy)"
echo "# Create SOCKS5 proxy for secure browsing"
echo 'ssh_tunnel_create server:"prod1" type:"dynamic" localPort:1080'
echo '# Configure browser to use SOCKS5 proxy at localhost:1080'
echo ""
echo "# 4. List active tunnels"
echo 'ssh_tunnel_list'
echo 'ssh_tunnel_list server:"prod1"  # Filter by server'
echo ""
echo "# 5. Close tunnels"
echo 'ssh_tunnel_close tunnelId:"tunnel_1234567_abcd"  # Close specific tunnel'
echo 'ssh_tunnel_close server:"prod1"  # Close all tunnels for server'
echo ""
echo "💡 Common Use Cases:"
echo "===================="
echo ""
echo "1. Access Remote Database:"
echo '   ssh_tunnel_create server:"dbserver" type:"local" localPort:5433 remoteHost:"localhost" remotePort:5432'
echo '   psql -h localhost -p 5433 -U user dbname'
echo ""
echo "2. Access Remote Web Service:"
echo '   ssh_tunnel_create server:"webserver" type:"local" localPort:8080 remoteHost:"localhost" remotePort:80'
echo '   # Browse to http://localhost:8080'
echo ""
echo "3. Expose Local Development Server:"
echo '   ssh_tunnel_create server:"public-server" type:"remote" localPort:3000 remoteHost:"0.0.0.0" remotePort:8080'
echo '   # Access your dev server via public-server:8080'
echo ""
echo "4. Secure Browsing via SOCKS:"
echo '   ssh_tunnel_create server:"vpn-server" type:"dynamic" localPort:1080'
echo '   # Configure browser: SOCKS5 proxy localhost:1080'
echo ""
echo "5. Access Private Network Services:"
echo '   ssh_tunnel_create server:"gateway" type:"local" localPort:8000 remoteHost:"internal.service" remotePort:80'
echo '   # Access internal service via localhost:8000'
echo ""
echo "🔒 Security Notes:"
echo "=================="
echo "• Tunnels are encrypted end-to-end via SSH"
echo "• Local forwarding: Secure access to remote services"
echo "• Remote forwarding: Be careful exposing local services"
echo "• SOCKS proxy: Routes all traffic through SSH server"
echo "• Auto-reconnect enabled with exponential backoff"
echo "• Idle tunnel monitoring every 30 seconds"
echo ""
echo "⚙️ Advanced Options:"
echo "===================="
echo "• localHost: Bind to specific interface (default: 127.0.0.1)"
echo "• Multiple tunnels can be created per server"
echo "• Tunnels persist until explicitly closed or server disconnects"
echo "• Statistics tracked: connections, bytes transferred, errors"