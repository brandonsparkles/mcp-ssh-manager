# Social Media Announcement - v3.1.0

## Twitter/X Post

🚀 NEW: MCP SSH Manager v3.1.0 - Tool Activation System!

Reduce context usage by 92% with intelligent tool activation. Enable only what you need:

✅ 37 DevOps tools (SSH, Database, Backup, Monitoring)
✅ 6 tool groups (Core → Advanced)
✅ Compatible with Claude Code & OpenAI Codex
✅ Auto-approval config export

Install: `npm i -g mcp-ssh-manager`

📦 https://github.com/bvisible/mcp-ssh-manager
🌟 Star if useful!

#MCP #ClaudeCode #DevOps #SSH #AI #Automation

---

## Reddit Post (r/ClaudeAI)

**Title:** MCP SSH Manager v3.1.0 - Comprehensive SSH automation with 92% context reduction

**Body:**

I've been working on MCP SSH Manager, a Model Context Protocol server that brings comprehensive SSH management to Claude Code (and OpenAI Codex).

**What is it?**

A complete DevOps automation platform with 37 MCP tools for managing remote SSH servers directly from Claude Code:

- 🔧 Core SSH operations (execute, upload, download, sync)
- 💾 Backup & restore (MySQL, PostgreSQL, MongoDB, files)
- 🏥 Health monitoring (CPU, RAM, disk, network, services)
- 🗄️ Database management (dumps, imports, queries)
- 🚇 SSH tunnels (local, remote, SOCKS)
- 📦 Advanced features (persistent sessions, server groups, profiles, hooks)

**What's new in v3.1.0?**

Tool activation system - reduce context usage by **92%**!

- Enable only the tools you need (minimal mode: 5 tools vs all 37)
- 6 tool groups: Core, Sessions, Monitoring, Backup, Database, Advanced
- CLI: `ssh-manager tools configure` for interactive setup
- Export auto-approval configs for Claude Code

**Why build this?**

Existing MCP SSH tools offer 2-4 basic operations. I needed enterprise DevOps features: automated backups, health monitoring, database operations, etc.

**Installation:**

```bash
npm install -g mcp-ssh-manager
```

**Configuration:**

Claude Code:
```json
{
  "mcpServers": {
    "ssh-manager": {
      "command": "node",
      "args": ["/path/to/mcp-ssh-manager/src/index.js"]
    }
  }
}
```

OpenAI Codex:
```bash
ssh-manager codex setup
```

**Links:**

- GitHub: https://github.com/bvisible/mcp-ssh-manager
- NPM: https://www.npmjs.com/package/mcp-ssh-manager
- Glama.ai: https://glama.ai/mcp/servers/@bvisible/mcp-ssh-manager
- Documentation: Full guides for all features

**Features I'm proud of:**

- Dual compatibility (Claude Code + OpenAI Codex)
- Profile system (default, docker, frappe, nodejs)
- Hooks for automation (pre-deploy, post-deploy, on-error)
- Command aliases (reduce typing)
- Comprehensive testing & CI/CD
- 92% context reduction with tool activation

Would love feedback! Star on GitHub if you find it useful ⭐

---

## Hacker News Post (Show HN)

**Title:** Show HN: MCP SSH Manager – 37 DevOps tools for Claude Code with 92% context reduction

**Body:**

Hi HN! I built MCP SSH Manager, a comprehensive Model Context Protocol server for SSH automation with Claude Code and OpenAI Codex.

**The problem:** Existing MCP SSH tools offer 2-4 basic operations (execute, upload, download). I needed enterprise DevOps features like automated backups, health monitoring, and database management - directly accessible from my AI assistant.

**What I built:**

37 MCP tools organized into 6 groups:
- Core (5): SSH execute, upload, download, sync, sudo
- Sessions (4): Persistent SSH sessions
- Monitoring (6): Health checks, service status, process management
- Backup (4): MySQL/PostgreSQL/MongoDB/file backups with scheduling
- Database (4): Dumps, imports, queries, table listings
- Advanced (14): Tunnels, groups, profiles, hooks, aliases

**New in v3.1.0: Tool Activation System**

The biggest challenge was context usage - 37 tools consume ~43.5k tokens. Solution: intelligent tool activation.

- Users can enable only needed tool groups
- Minimal mode: 5 tools (~3.5k tokens) = 92% reduction
- Interactive CLI: `ssh-manager tools configure`
- Export auto-approval configs for Claude Code

**Technical details:**

- Built with @modelcontextprotocol/sdk + ssh2
- Dual config support: .env (Claude) + TOML (Codex)
- Profile system for different workflows (docker, nodejs, frappe)
- Hooks for automation (pre-deploy, post-deploy, on-error)
- Comprehensive testing with GitHub Actions CI/CD

**Stack:**

- Node.js 18+
- SSH2 for connections
- Zod for validation
- TOML parser for Codex configs

**Example use cases:**

1. "Deploy my app to production server, create a database backup first"
2. "Check health of all my servers and alert me if any are above 80% CPU"
3. "Execute this command on all servers in the 'web' group sequentially"
4. "Create a backup of the MySQL database and schedule it to run daily at 2am"

**Links:**

- Repo: https://github.com/bvisible/mcp-ssh-manager
- NPM: https://www.npmjs.com/package/mcp-ssh-manager
- Docs: https://github.com/bvisible/mcp-ssh-manager#readme

Would love HN's feedback! What other DevOps automation would you want accessible from your AI assistant?

---

## LinkedIn Post

🚀 Excited to announce MCP SSH Manager v3.1.0!

After months of development, I'm releasing a comprehensive Model Context Protocol server that brings enterprise DevOps automation to Claude Code and OpenAI Codex.

**What does it do?**

Think of it as giving your AI assistant direct, controlled access to your SSH servers with 37 specialized tools:

✅ Execute commands remotely
✅ Automated database backups (MySQL, PostgreSQL, MongoDB)
✅ Health monitoring (CPU, RAM, disk, network)
✅ File transfers & synchronization
✅ SSH tunnel management
✅ Database operations
✅ And much more...

**Key innovation in v3.1.0:**

Tool activation system reduces AI context usage by 92%. Enable only the tools you need - from 5 core tools to all 37 advanced features.

**Why this matters:**

DevOps teams spend hours on repetitive SSH tasks. With MCP SSH Manager, you can ask Claude Code:

"Deploy the app to production, backup the database first, and monitor the health metrics"

And it handles everything - safely and automatically.

**Enterprise-ready features:**

- Profile system for different workflows
- Automation hooks (pre-deploy, post-deploy, on-error)
- Server groups for batch operations
- Comprehensive audit logging
- Security-first design

Check it out: https://github.com/bvisible/mcp-ssh-manager

#DevOps #AI #Automation #ClaudeCode #SSH #EnterpriseIT #CloudComputing

---

## Dev.to / Medium Article Outline

**Title:** "Building an Enterprise DevOps Platform with Model Context Protocol: Lessons from MCP SSH Manager"

**Sections:**

1. **Introduction**
   - What is MCP?
   - Why SSH automation?
   - The gap in existing solutions

2. **Architecture Overview**
   - MCP SDK integration
   - Tool design patterns
   - Connection pooling
   - Security considerations

3. **The Tool Activation Challenge**
   - Context token limits
   - 37 tools = 43.5k tokens
   - Solution: Dynamic tool activation
   - 92% reduction achieved

4. **Technical Deep Dives**
   - Dual configuration support (.env + TOML)
   - Profile system architecture
   - Hooks and automation
   - Testing strategy

5. **Real-world Use Cases**
   - Automated deployments
   - Database backup workflows
   - Health monitoring dashboards
   - Multi-server management

6. **Lessons Learned**
   - Tool granularity vs. simplicity
   - Security in AI-accessible systems
   - Error handling for AI consumers
   - Documentation for AI understanding

7. **Future Directions**
   - Community feedback
   - Planned features
   - MCP ecosystem growth

8. **Getting Started**
   - Installation guide
   - Quick start examples
   - Links to resources

---

## YouTube Video Script Outline

**Title:** "MCP SSH Manager v3.1.0 - Automate DevOps with Claude Code (92% Context Reduction)"

**Duration:** 8-10 minutes

**Outline:**

1. **Intro (30 sec)**
   - What we're building
   - Why it matters

2. **Problem Statement (1 min)**
   - Manual SSH tasks
   - Existing MCP tools limitations
   - Context usage challenges

3. **Demo: Basic Setup (2 min)**
   - Install from npm
   - Configure Claude Code
   - First SSH command

4. **Demo: Tool Activation (2 min)**
   - Show all 37 tools
   - Run `ssh-manager tools configure`
   - Compare context usage

5. **Demo: Real DevOps Workflow (3 min)**
   - Deploy app
   - Backup database
   - Monitor health
   - All from Claude Code

6. **Feature Highlights (1.5 min)**
   - Profiles
   - Hooks
   - Server groups
   - OpenAI Codex support

7. **Outro (30 sec)**
   - Links
   - Call to action (star on GitHub)
   - What's next

---

## Instagram/Visual Content Ideas

1. **Infographic: "37 DevOps Tools, 92% Less Context"**
   - Visual comparison: All tools vs Minimal mode
   - Token usage chart
   - Tool group breakdown

2. **Carousel: "From Manual SSH to AI-Powered DevOps"**
   - Slide 1: Old way (terminal commands)
   - Slide 2: MCP SSH Manager way (Claude Code)
   - Slide 3: Results (time saved, errors reduced)
   - Slide 4: Get started (GitHub link)

3. **Short Video: "Deploy in 10 Seconds with Claude Code"**
   - Screen recording of deployment workflow
   - Before/after comparison
   - Call to action

---

## Community Engagement Plan

**Week 1:**
- Post on Reddit r/ClaudeAI, r/devops, r/MachineLearning
- Share on Twitter/X with relevant hashtags
- Post on LinkedIn
- Submit to Hacker News

**Week 2:**
- Write Dev.to article
- Create YouTube demo video
- Engage with comments/questions
- Update Glama.ai listing

**Week 3:**
- Write Medium article (technical deep dive)
- Submit to awesome-mcp lists
- Answer Stack Overflow questions about MCP SSH
- Create comparison article

**Week 4:**
- Follow up on MCP official repo submission
- Collect user feedback
- Plan v3.2.0 based on feedback
- Create case studies

---

## Hashtags to Use

**General:**
#MCP #ModelContextProtocol #ClaudeCode #OpenAICodex #AI #Automation #DevOps

**Technical:**
#SSH #RemoteManagement #CloudComputing #Infrastructure #IaC #SRE #Platform

**AI-specific:**
#AITools #LLM #AIAgent #AIAssistant #Anthropic #OpenAI #Claude

**Community:**
#OpenSource #JavaScript #NodeJS #TypeScript #NPM #GitHub

---

## Key Messages to Emphasize

1. **Most comprehensive** - 37 tools vs competitors' 2-4
2. **Enterprise-ready** - Not just basic SSH, full DevOps platform
3. **Efficient** - 92% context reduction with tool activation
4. **Dual support** - Claude Code AND OpenAI Codex
5. **Production-ready** - Extensive testing, CI/CD, documentation
6. **Active development** - Regular updates, community-driven

---

## Call to Action Options

1. **For developers:** "Star on GitHub if you find it useful!"
2. **For users:** "Try it now: `npm install -g mcp-ssh-manager`"
3. **For contributors:** "Issues and PRs welcome!"
4. **For feedback:** "What DevOps features would you like to see next?"
5. **For community:** "Join the discussion on GitHub Discussions"
