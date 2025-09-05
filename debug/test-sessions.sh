#!/bin/bash

echo "🧪 Test SSH Sessions"
echo "===================="
echo ""
echo "SSH Sessions allow you to maintain state across multiple commands,"
echo "keeping context like working directory and environment variables."
echo ""
echo "📋 Test Commands for SSH Sessions:"
echo "==================================="
echo ""
echo "# 1. Start a new session"
echo 'ssh_session_start server:"test-server" name:"Development Session"'
echo ""
echo "# 2. Send commands to the session"
echo 'ssh_session_send session:"ssh_1234567_abcd" command:"cd /var/www"'
echo 'ssh_session_send session:"ssh_1234567_abcd" command:"pwd"'
echo 'ssh_session_send session:"ssh_1234567_abcd" command:"ls -la"'
echo ""
echo "# 3. List active sessions"
echo 'ssh_session_list'
echo 'ssh_session_list server:"test-server"'
echo ""
echo "# 4. Close a session"
echo 'ssh_session_close session:"ssh_1234567_abcd"'
echo 'ssh_session_close session:"all"  # Close all sessions'
echo ""
echo "📝 Session Features:"
echo "==================="
echo "✅ Persistent state across commands"
echo "✅ Working directory maintained"
echo "✅ Command history tracking"
echo "✅ Session variables support"
echo "✅ Auto-cleanup of inactive sessions (30 min)"
echo "✅ Multiple concurrent sessions"
echo ""
echo "💡 Use Cases:"
echo "============="
echo "1. Interactive debugging sessions"
echo "2. Multi-step deployment workflows"
echo "3. Environment setup and testing"
echo "4. Long-running processes monitoring"
echo ""
echo "⚠️  Note: Replace 'test-server' with an actual configured server"
echo "    Session IDs are generated automatically when you start a session"