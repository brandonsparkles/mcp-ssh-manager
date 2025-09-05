#!/bin/bash

echo "🧪 Test Server Groups"
echo "====================="
echo ""
echo "Server Groups allow batch operations on multiple servers with"
echo "different execution strategies (parallel, sequential, rolling)."
echo ""
echo "📋 Test Commands for Server Groups:"
echo "==================================="
echo ""
echo "# 1. List existing groups"
echo 'ssh_group_manage action:"list"'
echo ""
echo "# 2. Create a new group"
echo 'ssh_group_manage action:"create" name:"webservers" servers:["web1","web2","web3"] description:"Web application servers" strategy:"rolling" delay:5000'
echo ""
echo "# 3. Add servers to a group"
echo 'ssh_group_manage action:"add-servers" name:"production" servers:["prod1","prod2"]'
echo ""
echo "# 4. Execute command on a group"
echo 'ssh_execute_group group:"all" command:"uptime" strategy:"parallel"'
echo 'ssh_execute_group group:"production" command:"df -h" strategy:"rolling" delay:3000'
echo 'ssh_execute_group group:"webservers" command:"systemctl status nginx" stopOnError:true'
echo ""
echo "# 5. Update group settings"
echo 'ssh_group_manage action:"update" name:"production" strategy:"rolling" delay:10000 stopOnError:true'
echo ""
echo "# 6. Remove servers from group"
echo 'ssh_group_manage action:"remove-servers" name:"staging" servers:["old-server"]'
echo ""
echo "# 7. Delete a group"
echo 'ssh_group_manage action:"delete" name:"temp-group"'
echo ""
echo "📝 Execution Strategies:"
echo "======================="
echo "• parallel   - Execute on all servers simultaneously (fastest)"
echo "• sequential - Execute one by one in order"
echo "• rolling    - Execute one by one with delay between (safest)"
echo ""
echo "💡 Default Groups:"
echo "=================="
echo "• all        - Dynamic group containing all configured servers"
echo "• production - For production servers (rolling by default)"
echo "• staging    - For staging/test servers"  
echo "• development- For dev servers"
echo ""
echo "⚙️ Use Cases:"
echo "============="
echo "• Deploy updates to all web servers"
echo "• Restart services across a cluster"
echo "• Collect metrics from multiple hosts"
echo "• Execute maintenance tasks"
echo "• Rolling deployments with validation"
echo ""
echo "⚠️  Note: Groups are persisted in .server-groups.json"
echo "    The 'all' group is dynamic and includes all configured servers"