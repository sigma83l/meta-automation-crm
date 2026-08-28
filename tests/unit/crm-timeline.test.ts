import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import { SupabaseCrmRepository } from "@/src/modules/crm/adapters/supabase-crm-repository";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import {
  EMPTY_TIMELINE,
  TIMELINE_KINDS,
  buildTimeline,
  filterTimeline,
  isTimelineCategory,
  type TimelineInput
} from "@/src/modules/crm/timeline";

/**
 * The relationship, reconstructed.
 *
 * The pack's goal is to reconstruct it without drowning the operator in
 * machinery, so the tests worth writing are about the line between the two: a
 * recomputation that moved nothing is machinery, a score that actually changed
 * is history, and neither may be thrown away. The other half is ordering -
 * events from ten tables have to interleave by time, and two at the same
 * instant must not swap between reads.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const OWNER = "55555555-5555-4555-8555-555555555555";

const workspace: TrustedWorkspace = {
  id: WORKSPACE,
  name: "Probe",
  userId: OWNER,
  role: "operator"
};

const input = (over: Partial<TimelineInput> = {}): TimelineInput => ({
  ...EMPTY_TIMELINE,
  ...over
});

const message = (id: string, at: string, direction: "inbound" | "outbound" = "inbound") => ({
  id,
  conversationId: "conv-1",
  direction,
  body: "Can you send the quote?",
  sentAt: at
});

describe("what belongs on a timeline", () => {
  it("interleaves events from different tables by time, newest first", () => {
    const events = buildTimeline(
      input({
        messages: [message("m1", "2026-08-20T10:00:00.000Z")],
        notes: [{ id: "n1", body: "Called them", createdAt: "2026-08-22T10:00:00.000Z" }],
        lifecycle: [
          {
            id: "l1",
            fromStage: "engaged",
            toStage: "qualified",
            reasonCodes: ["budget_confirmed"],
            actor: OWNER,
            evidenceRef: "ev-1",
            occurredAt: "2026-08-21T10:00:00.000Z"
          }
        ]
      })
    );
    expect(events.map((event) => event.id)).toEqual(["note:n1", "lifecycle:l1", "message:m1"]);
  });

  it("orders two events at the same instant the same way every time", () => {
    // A timeline that reshuffles on refresh looks alive when nothing happened.
    const at = "2026-08-20T10:00:00.000Z";
    const twice = () =>
      buildTimeline(
        input({
          messages: [message("m2", at), message("m1", at)],
          notes: [{ id: "n1", body: "note", createdAt: at }]
        })
      ).map((event) => event.id);
    expect(twice()).toEqual(twice());
  });

  it("names who did it without inventing a person", () => {
    const events = buildTimeline(
      input({ messages: [message("m1", "2026-08-20T10:00:00.000Z", "outbound")] })
    );
    // `messages` records that this went out from here, not who wrote it.
    expect(events[0]!.actor).toBe("workspace");
    expect(events[0]!.kind).toBe("message_outbound");
  });

  it("tells a person's stage change from a machine's", () => {
    const events = buildTimeline(
      input({
        lifecycle: [
          {
            id: "l1",
            fromStage: null,
            toStage: "engaged",
            reasonCodes: [],
            actor: "system",
            evidenceRef: null,
            occurredAt: "2026-08-20T10:00:00.000Z"
          },
          {
            id: "l2",
            fromStage: "engaged",
            toStage: "qualified",
            reasonCodes: [],
            actor: OWNER,
            evidenceRef: null,
            occurredAt: "2026-08-21T10:00:00.000Z"
          }
        ]
      })
    );
    expect(events.map((event) => event.actor)).toEqual(["operator", "system"]);
  });

  it("carries the values a phrasing needs rather than a finished sentence", () => {
    // The product ships in three languages. A summary assembled here would only
    // ever be in one of them.
    const events = buildTimeline(
      input({
        scores: [
          {
            id: "s1",
            score: 62,
            previousScore: 40,
            configVersion: "v2",
            overrideBy: null,
            calculatedAt: "2026-08-20T10:00:00.000Z"
          }
        ]
      })
    );
    expect(events[0]!.detail).toEqual({ score: "62", previous: "40", version: "v2" });
    expect(events[0]!.text).toBeNull();
  });

  it("passes written words through as written", () => {
    const events = buildTimeline(
      input({
        notes: [{ id: "n1", body: "  Called them  ", createdAt: "2026-08-20T10:00:00.000Z" }]
      })
    );
    expect(events[0]!.text).toBe("  Called them  ");
  });

  it("records a follow-up's settlement as its own event", () => {
    const events = buildTimeline(
      input({
        followUps: [
          {
            id: "f1",
            objective: "Ask about the quote",
            dueAt: "2026-08-25T10:00:00.000Z",
            eligibilityState: "cancelled",
            ownerType: "automation",
            lastResult: "customer replied",
            createdAt: "2026-08-20T10:00:00.000Z",
            updatedAt: "2026-08-24T10:00:00.000Z"
          }
        ]
      })
    );
    expect(events.map((event) => event.kind)).toEqual(["followup_settled", "followup_scheduled"]);
  });

  it("leaves a live follow-up as one event", () => {
    const events = buildTimeline(
      input({
        followUps: [
          {
            id: "f1",
            objective: "Ask about the quote",
            dueAt: "2026-08-25T10:00:00.000Z",
            eligibilityState: "eligible",
            ownerType: "human",
            lastResult: null,
            createdAt: "2026-08-20T10:00:00.000Z",
            updatedAt: "2026-08-20T10:00:00.000Z"
          }
        ]
      })
    );
    expect(events).toHaveLength(1);
  });

  it("only ever produces a kind the model defines", () => {
    const events = buildTimeline(
      input({
        messages: [message("m1", "2026-08-20T10:00:00.000Z")],
        audit: [{ id: "a1", action: "customer.exported", occurredAt: "2026-08-20T11:00:00.000Z" }],
        handoffs: [
          { id: "h1", trigger: "customer_requested_human", raisedAt: "2026-08-20T12:00:00.000Z" }
        ],
        automations: [
          {
            id: "au1",
            automationKey: "welcome",
            state: "active",
            createdAt: "2026-08-20T13:00:00.000Z"
          }
        ],
        opportunities: [
          {
            id: "o1",
            stage: "won",
            valueBand: "medium",
            outcomeSource: "customer_confirmed",
            createdAt: "2026-08-20T14:00:00.000Z",
            updatedAt: "2026-08-21T14:00:00.000Z"
          }
        ]
      })
    );
    for (const event of events) expect(TIMELINE_KINDS).toContain(event.kind);
  });
});

describe("machinery is collapsed, not discarded", () => {
  const noisy = () =>
    buildTimeline(
      input({
        messages: [message("m1", "2026-08-20T10:00:00.000Z")],
        automations: [
          {
            id: "au1",
            automationKey: "welcome",
            state: "active",
            createdAt: "2026-08-20T11:00:00.000Z"
          }
        ],
        audit: [{ id: "a1", action: "customer.viewed", occurredAt: "2026-08-20T12:00:00.000Z" }]
      })
    );

  it("hides automation internals and the audit trail by default", () => {
    expect(filterTimeline(noisy()).map((event) => event.id)).toEqual(["message:m1"]);
  });

  it("gives all of it back when somebody asks", () => {
    // The moment an operator is working out why a reply went wrong, the
    // machinery is the thing they need.
    expect(filterTimeline(noisy(), { includeRoutine: true })).toHaveLength(3);
  });

  it("treats a recomputation that moved nothing as machinery", () => {
    const events = buildTimeline(
      input({
        scores: [
          {
            id: "s1",
            score: 62,
            previousScore: 62,
            configVersion: "v2",
            overrideBy: null,
            calculatedAt: "2026-08-20T10:00:00.000Z"
          }
        ]
      })
    );
    expect(events[0]!.routine).toBe(true);
    expect(filterTimeline(events)).toHaveLength(0);
    // Kept, though: a score that stopped moving is sometimes the question.
    expect(filterTimeline(events, { includeRoutine: true })).toHaveLength(1);
  });

  it("keeps a score that actually changed in the default view", () => {
    const events = buildTimeline(
      input({
        scores: [
          {
            id: "s1",
            score: 62,
            previousScore: 40,
            configVersion: "v2",
            overrideBy: null,
            calculatedAt: "2026-08-20T10:00:00.000Z"
          }
        ]
      })
    );
    expect(filterTimeline(events)).toHaveLength(1);
  });

  it("filters to the categories asked for", () => {
    const events = buildTimeline(
      input({
        messages: [message("m1", "2026-08-20T10:00:00.000Z")],
        notes: [{ id: "n1", body: "note", createdAt: "2026-08-21T10:00:00.000Z" }]
      })
    );
    expect(filterTimeline(events, { categories: ["messages"] }).map((event) => event.id)).toEqual([
      "message:m1"
    ]);
  });

  it("refuses a category nobody defined", () => {
    expect(isTimelineCategory("messages")).toBe(true);
    expect(isTimelineCategory("messages; drop table")).toBe(false);
  });
});

describe("the repository gathers the sources", () => {
  function harness(over: Record<string, FakeRow[]> = {}) {
    const fake = createFakeSupabase({
      tables: {
        messages: [],
        customer_notes: [],
        customer_activities: [],
        lifecycle_events: [],
        crm_score_snapshots: [],
        tasks_followups: [],
        opportunities: [],
        handoff_packets: [],
        customer_automation_references: [],
        crm_audit_events: [],
        ...over
      }
    });
    return new SupabaseCrmRepository(fake.client, workspace);
  }

  it("merges what it read into one ordered history", async () => {
    const repository = harness({
      messages: [
        {
          id: "m1",
          workspace_id: WORKSPACE,
          customer_id: CUSTOMER,
          conversation_id: "conv-1",
          direction: "inbound",
          body: "Hello",
          sent_at: "2026-08-20T10:00:00.000Z"
        }
      ],
      customer_notes: [
        {
          id: "n1",
          workspace_id: WORKSPACE,
          customer_id: CUSTOMER,
          body: "Called them",
          created_at: "2026-08-21T10:00:00.000Z"
        }
      ]
    });
    const events = await repository.timelineFor(CUSTOMER);
    expect(events.map((event) => event.id)).toEqual(["note:n1", "message:m1"]);
  });

  it("does not read another customer's history", async () => {
    const repository = harness({
      messages: [
        {
          id: "m1",
          workspace_id: WORKSPACE,
          customer_id: "someone-else",
          conversation_id: "conv-1",
          direction: "inbound",
          body: "Hello",
          sent_at: "2026-08-20T10:00:00.000Z"
        }
      ]
    });
    expect(await repository.timelineFor(CUSTOMER)).toHaveLength(0);
  });

  it("does not read another workspace's history", async () => {
    const repository = harness({
      messages: [
        {
          id: "m1",
          workspace_id: "someone-else",
          customer_id: CUSTOMER,
          conversation_id: "conv-1",
          direction: "inbound",
          body: "Hello",
          sent_at: "2026-08-20T10:00:00.000Z"
        }
      ]
    });
    expect(await repository.timelineFor(CUSTOMER)).toHaveLength(0);
  });

  it("bounds what it returns", async () => {
    const repository = harness({
      messages: Array.from({ length: 30 }, (_, index) => ({
        id: `m${index}`,
        workspace_id: WORKSPACE,
        customer_id: CUSTOMER,
        conversation_id: "conv-1",
        direction: "inbound",
        body: "Hello",
        sent_at: `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`
      }))
    });
    expect(await repository.timelineFor(CUSTOMER, {}, 5)).toHaveLength(5);
  });
});
