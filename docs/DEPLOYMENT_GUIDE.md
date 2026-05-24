# SSH Manager Deployment Guide

## Overview

This guide reflects the current `ssh_deploy`, `ssh_execute_sudo`, and `ssh_alias` behavior implemented in:

- `src/index.js`
- `src/deploy-helper.js`
- `src/server-aliases.js`

## Tool Capabilities

### `ssh_deploy`

Deploy one or more local files to remote paths.

#### Input schema

```json
{
  "server": "production",
  "files": [
    {
      "local": "/local/path/app.js",
      "remote": "/var/www/app/app.js"
    }
  ],
  "options": {
    "owner": "www-data:www-data",
    "permissions": "644",
    "backup": true,
    "restart": "nginx",
    "sudoPassword": "unsupported"
  }
}
```

#### What actually happens per file

1. Uploads local file to a generated remote temp path:
   - `/tmp/<basename>_<timestamp>_<randomhex><ext>`
2. Optionally attempts backup (default `backup: true`):
   - `<remote>.bak.YYYYMMDD_HHMMSS`
3. Copies temp file to target path (`cp` or `sudo -n cp` depending on path/options)
4. Optional ownership update: `sudo -n chown <owner> <remote>`
5. Optional mode update: `sudo -n chmod <permissions> <remote>`
6. Optional restart: `sudo -n systemctl restart <service>`
7. Deletes remote temp file

#### Important limits and validation

- `options.sudoPassword` is **rejected** (password-based sudo is intentionally unsupported).
- `restart` is a **service name**, not an arbitrary shell command.
- `permissions` must be octal string (`644`, `0755`, etc.).
- `owner` allows only safe `user` or `user:group` characters.
- Each deployment command step runs with a fixed 15s timeout.
- `options` apply to all files in the request (not per-file options).
- `backup` failures are non-fatal; other step failures fail deployment.

#### Auto-detected suggestions for owner/perms

If not provided, defaults are inferred from remote path:

- `/etc/*` → `root:root`, `644`
- `/var/www/*` → `www-data:www-data`, `644`
- paths containing `/nginx/` → `root:root`, `644`
- paths containing `/apache/` or `/httpd/` → `www-data:www-data`, `644`
- paths containing `/frappe-bench/` → permissions `644` only

Sudo use is triggered when remote path starts with `/etc/`, `/var/`, `/usr/`, or when `owner`/`permissions` is set.

### `ssh_execute_sudo`

Runs a command as sudo with non-interactive mode:

- Command is executed as `sudo -n <command-with-leading-sudo-removed>`
- Uses provided `cwd` or server `default_dir`/`defaultDir` when present
- `password` argument is **rejected**
- `server` config `sudoPassword`/`sudo_password` is also **rejected**

### `ssh_alias`

Manage server aliases:

- `action: add` requires `alias` + `server`
- `action: remove` requires `alias`
- `action: list` returns alias mappings

Alias file location:

- `<repo-root>/.server-aliases.json` (resolved from `src/server-aliases.js`)

Alias resolution supports:

- direct alias match
- exact server-name match (case-normalized)
- single partial server-name match
- hostname/domain-based match

## Hooks during deploy

`ssh_deploy` invokes:

- `pre-deploy`
- `post-deploy`

Hook config is read from:

- profile hooks in `profiles/*.json`
- optional override file `<repo-root>/.hooks-config.json`

Current behavior note: deploy calls `executeHook(...)` but does not enforce returned `success:false` as a hard stop unless an exception is thrown.

## Operational Notes

- Use absolute remote paths for predictable behavior.
- `restart` should be a simple systemd unit name (example: `nginx`, `php8.2-fpm`).
- Ensure target user has NOPASSWD sudo rights for any `sudo -n` steps.
- Server names come from loaded SSH config (`.env` and/or `~/.codex/ssh-config.toml` via config loader).

## Troubleshooting

### `sudo: a password is required`

Cause: target user lacks non-interactive sudo permission.

Fix: configure NOPASSWD sudo for required commands.

### Restart fails with invalid service input

Cause: `restart` value includes spaces or shell syntax.

Fix: pass only service name (for example, `nginx`), not `systemctl restart nginx`.

### Server not found

Cause: unresolved `server` name/alias.

Fix:

1. verify configured server name
2. check aliases via `ssh_alias` (`action: list`)
3. add alias with `ssh_alias` (`action: add`)

### Backup not created but deploy succeeds

Cause: backup step is best-effort and non-fatal.

Fix: verify target read permissions or perform explicit pre-deploy backup when required.
