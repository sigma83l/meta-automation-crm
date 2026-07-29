# Production hardening migration

Adds the two Prompt 8R recipes, non-owner membership role values, an atomic
database-backed authentication rate limiter, CRM import audit jobs, and
least-privilege role helper functions.

Rollback is corrective-only:

1. disable code paths using the new recipes and import jobs;
2. preserve import/audit evidence before dropping `crm_import_jobs`;
3. drop the rate-limit functions/table only after traffic is drained;
4. PostgreSQL enum values cannot be removed safely in place—leave them unused
   or migrate to a replacement enum in a separately reviewed maintenance
   window.
