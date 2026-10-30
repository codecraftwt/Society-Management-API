# Migration Guide

## Creating a new migration
1. Copy templates/migration_template.js to migrations/ with timestamp prefix
2. Fill in up() and down() methods
3. Test with migrate:status, migrate:dry-run, then migrate

## Naming convention
Use timestamp: YYYYMMDDHHMMSS_description.js

## Best practices
- Make migrations idempotent - check if changes exist before applying
- Never drop data destructively without explicit backup
- For fresh DBs, migrations must create all required tables in dependency order
- Always test on a disposable DB first
- For large changes, use transactions where possible (MySQL DDL may auto-commit)
