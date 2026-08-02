# Backup and Restore

Use `docs/BACKUP_RESTORE_RUNBOOK.md` for the tested local procedure and hosted
requirements.

The local custom-format drill restored eight migration records, public
forced-RLS tables and automation enums into an isolated temporary database.
Managed Supabase Vault schema remains present while managed `vault.secrets`
table data is excluded from application-owned dumps.

Hosted PITR, plan retention, RPO/RTO measurement and an isolated hosted restore
remain owner/project gates. Never restore Production customer data into Preview
or load environments.
