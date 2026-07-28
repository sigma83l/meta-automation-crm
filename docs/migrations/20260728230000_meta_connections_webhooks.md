# Meta Connections and Webhooks Migration

Adds workspace Meta connections, normalized webhook events, a durable
`meta/webhook.received` outbox, and connection audit metadata. Tokens are
AES-GCM envelopes; authenticated browser users receive column-limited metadata
and cannot write connections or invoke trusted ingestion.

`ingest_meta_event` is service-role-only and atomically resolves provider
account ownership, checks active state, deduplicates, persists minimal content,
and creates exactly one outbox row.

Rollback first disables webhook delivery and drains the outbox, then drops the
ingestion function and Prompt 4 tables. Do not roll back while Meta is still
sending events.
