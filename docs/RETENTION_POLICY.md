# Retention and Deletion Policy

Customer files may set `retention_until`; `deleted_at` records logical deletion
after the private object is removed. Customer deletion is restricted when audit
evidence references it. Workspace erasure requires a reviewed background
workflow that removes private objects before database rows.

CRM ZIP exports expire after `CRM_EXPORT_TTL_SECONDS` (default 15 minutes).
Expired downloads are denied, the object is removed, and the job becomes
`expired`. Failed synchronous exports remove any object already uploaded.
The registered daily durable cleanup removes expired private export objects,
marks jobs expired, and purges expired authentication limiter windows. Hosted
execution must still be verified and aligned with the published privacy policy
and legal holds.

The business-profile `retention_days` value is the policy input for later
scheduled deletion. Prompt 3 creates no raw AI prompt archive. Credential
envelopes persist only while enabled and are removed immediately on delete;
metadata-only audit events follow the approved audit-retention schedule.
