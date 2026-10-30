# Migration Deployment Workflow

## Pre-deployment
1. Backup database: mysqldump -u user -p database > backup_YYYYMMDD_HHMMSS.sql
2. Review pending migrations: 
pm run migrate:status
3. Test in staging environment first
4. Review dry-run: 
pm run migrate:dry-run

## Deployment steps (in order)
1. **Deploy code** - Update application code to include new migrations
2. **Run migrations** - 
pm run migrate (must complete successfully)
3. **Verify** - Check migration status, run validation
4. **Start/restart API** - Only after migrations complete successfully
5. **Smoke test** - Verify application functionality

## Important notes
- Never run migrations during normal application startup
- Always run migrations as a separate deployment step
- If migration fails, do NOT start the application
- For production, run migrations with appropriate permissions
- Keep migration files in version control

## Creating new schema changes
1. Modify Sequelize model in models/
2. Create migration: 
pm run migrate:create add_new_column_to_users
3. Edit the migration file in migrations/
4. Test locally: status, dry-run, migrate
5. Commit migration and model changes together
6. Deploy following the workflow above
