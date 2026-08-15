# Search, Pagination, Realtime, and Cache Rules

**Source page:** 28

- Cursor pagination for messages, threads, and timeline.
- No unbounded queries.
- Search indexes are scoped by `workspace_id`.
- Fuzzy/full-text search only where justified.
- Realtime subscriptions only on authenticated workspace-safe channels.
- Short polling is acceptable in V1 when safer/simpler.
- Derived/materialized views are rebuildable.
- Cache keys always include workspace + permission context + version.
- No cross-tenant cache reuse.
- Query plans and indexes must be part of DB acceptance tests.
