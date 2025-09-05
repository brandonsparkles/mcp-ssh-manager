#!/bin/bash

echo "🧪 Test SSH Monitoring Tools"
echo "============================"
echo ""

# Create test log file locally for demo
TEST_LOG="/tmp/test-app.log"
echo "Creating test log file at $TEST_LOG..."

# Generate some test log data
cat > $TEST_LOG << 'EOF'
2025-09-05 10:00:00 [INFO] Application started
2025-09-05 10:00:01 [DEBUG] Loading configuration
2025-09-05 10:00:02 [INFO] Database connection established
2025-09-05 10:00:03 [ERROR] Failed to connect to cache server
2025-09-05 10:00:04 [WARN] Retrying cache connection...
2025-09-05 10:00:05 [INFO] Cache connected on retry
2025-09-05 10:00:06 [INFO] Starting web server on port 3000
2025-09-05 10:00:07 [DEBUG] Routes registered
2025-09-05 10:00:08 [INFO] Server ready
2025-09-05 10:00:09 [INFO] Received request: GET /api/status
2025-09-05 10:00:10 [ERROR] Unhandled exception in /api/users
2025-09-05 10:00:11 [WARN] High memory usage detected: 85%
2025-09-05 10:00:12 [INFO] Request completed: 200 OK
EOF

echo "✅ Test log created with sample data"
echo ""
echo "📋 Test Commands for ssh_tail:"
echo "==============================="
echo ""
echo "# Tail last 5 lines (no follow)"
echo 'ssh_tail server:"test-server" file:"/tmp/test-app.log" lines:5 follow:false'
echo ""
echo "# Tail and filter for ERROR messages only"
echo 'ssh_tail server:"test-server" file:"/tmp/test-app.log" grep:"ERROR" follow:false'
echo ""
echo "# Follow log in real-time (will stream to stderr)"
echo 'ssh_tail server:"test-server" file:"/var/log/syslog" lines:10 follow:true'
echo ""
echo "📊 Test Commands for ssh_monitor:"
echo "=================================="
echo ""
echo "# Get system overview"
echo 'ssh_monitor server:"test-server" type:"overview"'
echo ""
echo "# Monitor CPU usage"
echo 'ssh_monitor server:"test-server" type:"cpu"'
echo ""
echo "# Check memory usage"
echo 'ssh_monitor server:"test-server" type:"memory"'
echo ""
echo "# Check disk space"
echo 'ssh_monitor server:"test-server" type:"disk"'
echo ""
echo "# Monitor network"
echo 'ssh_monitor server:"test-server" type:"network"'
echo ""
echo "# Check running processes"
echo 'ssh_monitor server:"test-server" type:"process"'
echo ""
echo "# Continuous monitoring (not fully implemented)"
echo 'ssh_monitor server:"test-server" type:"overview" interval:5 duration:30'
echo ""
echo "⚠️  Note: Replace 'test-server' with an actual configured server name"
echo "    Run 'ssh_list_servers' to see available servers"
echo ""
echo "💡 Tips:"
echo "  - ssh_tail with follow:true will stream output continuously"
echo "  - ssh_monitor provides different views of system state"
echo "  - Use grep parameter in ssh_tail to filter log lines"
echo "  - All monitoring operations are logged with the logger system"