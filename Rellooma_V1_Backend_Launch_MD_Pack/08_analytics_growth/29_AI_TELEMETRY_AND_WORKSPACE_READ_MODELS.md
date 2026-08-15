# AI Telemetry and Workspace Analytics Read Models

**Source pages:** 21, 28

## AI telemetry per `agent_run`

Record:

- provider;
- model_role;
- model_id;
- prompt_version;
- snapshot_hash;
- input_tokens;
- cached_tokens;
- output_tokens;
- latency_ms;
- tool_calls;
- validation_result;
- retry_count;
- confidence;
- route_reason;
- outcome_ref.

## Workspace analytics

- response time + first useful response;
- qualified lead rate + reasons;
- booking/verified outcome rate;
- handoff rate + load + SLA;
- follow-up recovery;
- CRM completeness / repeated-question rate;
- automation success/failure by version.

## Read models

| Read model | Used by | Design |
|---|---|---|
| `workspace_overview_view` | Overview | health, blockers, recent outcomes, task counts |
| `inbox_threads_view` | Inbox list | contact, channel, status, owner, unread, last_message_at, priority |
| `conversation_context_view` | Inbox context | facts, lifecycle, score reasons, tasks, handoff, policy |
| `contact_revenue_state_view` | CRM detail | lifecycle/status/score/evidence/outcome summary |
| `usage_summary_view` | Usage/Billing | cycle counters + thresholds |
| `integration_health_view` | Integrations | state, last activity, error code, recovery action |
| `analytics_daily_view` | Analytics | workspace/day aggregate outcome + load metrics |
| `support_ticket_view` | Support | status/SLA/last actor |

Derived views are rebuildable; immutable events remain source of truth.
