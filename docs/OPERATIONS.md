# Operations

Use `docs/OPERATIONS_MANUAL.md`, `docs/SLOS_AND_ALERTS.md` and
`docs/INCIDENT_RESPONSE.md` for detailed procedures.

The global shell exposes environment state, channel health, attention links and
an offline state. Automation detail provides safe test, pause and queued-step
stop controls. Inbox takeover/resume and every human or automation send remain
under the same immediate policy gate.

Operational analytics are backed by workspace database counts and link to the
underlying records. No decorative or inferred business KPI is presented.

The first response to uncertain provider persistence is `sent_unknown`, not an
automatic retry. Emergency recovery is bounded, idempotent and audited.
