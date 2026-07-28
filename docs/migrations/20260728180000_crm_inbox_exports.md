# CRM, inbox and export migration rollback

Rollback is destructive and requires an approved backup. Remove the
`customer-media` and `crm-exports` objects first, then drop Prompt 2 tables in
reverse foreign-key order, their policies, buckets, and enum types. Never roll
back a production workspace without an export, retention review and MANI
approval.
