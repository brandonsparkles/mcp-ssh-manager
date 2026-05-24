# Backup & Restore Guide

This guide reflects the current behavior of `src/backup-manager.js`, backup tool handlers in `src/index.js`, and CLI tool-group wrappers.

## Overview

Backup tools in this project:
- `ssh_backup_create`
- `ssh_backup_list`
- `ssh_backup_restore`
- `ssh_backup_schedule`

Default backup directory: `/var/backups/ssh-manager`

## Supported Types

### `ssh_backup_create`
Accepted `type` values:
- `mysql`
- `postgresql`
- `mongodb`
- `files`
- `full` *(declared, but currently returns: "Full backup not yet implemented")*

### `ssh_backup_list`
Optional filter supports:
- `mysql`, `postgresql`, `mongodb`, `files`, `full`

### `ssh_backup_schedule`
Accepted `type` values:
- `mysql`, `postgresql`, `mongodb`, `files`

## Tool Parameters (Verified)

### `ssh_backup_create`
Required:
- `server`
- `type`
- `name`

Conditionally required:
- `database` for `mysql` / `postgresql` / `mongodb`
- `paths` (non-empty array) for `files`

Optional:
- `dbUser`, `dbPassword`, `dbHost`, `dbPort`
- `exclude` (files backups only)
- `backupDir` (overrides default directory)
- `retention` (default `7`)
- `compress` (default `true`)

### `ssh_backup_list`
- `server` (required)
- `type` (optional)
- `backupDir` (optional)

### `ssh_backup_restore`
- `server`, `backupId` (required)
- Optional: `database`, `dbUser`, `dbPassword`, `dbHost`, `dbPort`, `targetPath`, `backupDir`

### `ssh_backup_schedule`
- Required: `server`, `schedule`, `type`, `name`
- Optional: `database`, `paths`, `retention`

Validation enforced for schedule:
- `schedule` must be exactly 5 cron fields using safe characters `[A-Za-z0-9*,/-]`
- `name` must match `[A-Za-z0-9_.-]+`
- `retention` must be a non-negative integer

## Scheduling Behavior

`ssh_backup_schedule`:
1. Writes `/usr/local/bin/ssh-manager-backup-<name>.sh`
2. Appends a cron entry via `(crontab -l; echo <line>) | crontab -`
3. Script always writes to `/var/backups/ssh-manager`
4. Script always produces gzip/tar.gz output
5. Script performs retention cleanup using:
   - `find "$BACKUP_DIR" -name "*_<name>_*" -type f -mtime +<retention> -delete`

Important limitations:
- Repeated scheduling with the same `name` can create duplicate cron lines (no dedupe).
- No per-schedule `backupDir`, DB host/user/password/port, `compress`, or `exclude` options.
- Scheduled MySQL/PostgreSQL backups rely on ambient DB auth context.

## Retention Behavior

### On-demand backups (`ssh_backup_create`)
After a successful backup, cleanup runs immediately:
- `find <backupDir> -name '*_*_*' -type f -mtime +<retention> -delete`

Notes:
- Scope is broad (`*_*_*`) and not restricted to a backup name.
- Uses `-mtime +N` (older than N*24h).
- `retention` is not strictly validated in create path.

### Scheduled backups (`ssh_backup_schedule`)
Cleanup is per backup `name` (`*_<name>_*`) and retention is validated as a non-negative integer.

## Restore Behavior & Current Limitations

Restore reads metadata from `<backupId>.meta.json`, then attempts to restore from `<backupId>.gz`.

Limitations:
- MongoDB create flow typically writes `.tar.gz` archives, but restore lookup uses `.gz`. MongoDB backups created with default compression may fail to restore without manual intervention.
- No dry-run mode.
- No built-in overwrite safeguards for file restores (`targetPath` defaults to `/`).

## Database/File Notes

### MySQL
- Uses `mysqldump --single-transaction --routines --triggers`
- Defaults: host `localhost`, port `3306`

### PostgreSQL
- Uses `pg_dump --format=custom --clean --if-exists`
- Uses `PGPASSWORD=...` when password provided
- Defaults: host `localhost`, port `5432`

### MongoDB
- Uses `mongodump` / `mongorestore`
- Defaults: host `localhost`, port `27017`

### Files
- Uses `tar` (`-czf` when compressed, `-cf` when not)
- Supports multiple source paths
- Supports `--exclude` patterns
- Archives symlinks as symlinks by default (does not force dereference)

## Hook Events

Backup tools emit these hooks:
- `pre-backup` context: `{ server, type, database, paths }`
- `post-backup` context: `{ server, backupId, type, size, success, error }`
- `pre-restore` context: `{ server, backupId, type, database }`
- `post-restore` context: `{ server, backupId, type, success, error }`

## CLI Wrapper / Tool Group Notes

In `cli/commands/tools.sh`, backup functionality is exposed as the **backup** group (4 tools):
- `ssh_backup_create`
- `ssh_backup_list`
- `ssh_backup_restore`
- `ssh_backup_schedule`

Operational impact:
- `all` mode includes backup tools.
- `minimal` mode excludes backup tools.
- `custom` mode includes them only when `.groups.backup.enabled = true`.
