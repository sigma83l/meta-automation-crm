import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import { SupabaseCrmRepository } from "@/src/modules/crm/adapters/supabase-crm-repository";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import type { TransitionInput } from "@/src/modules/crm/contracts";

/**
 * The decision half of a lifecycle move.
 *
 * The database owns atomicity and the concurrency check, and those are proven
 * against a real engine in tests/migrations. What is proven here is the part
 * that happens before any of that: a move the rules refuse never reaches the
 * database at all, and the three outcomes stay distinguishable to the caller.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";

const workspace: TrustedWorkspace = {
  id: WORKSPACE,
  name: "Probe",
  userId: "55555555-5555-4555-8555-555555555555",
  role: "operator"
};

const transition = (over: Partial<TransitionInput> = {}): TransitionInput => ({
  customerId: CUSTOMER,
  from: "new",
  to: "engaged",
  reasonCodes: ["replied_to_first_message"],
  evidenceRef: "msg-1",
  actor: "system",
  ...over
});

function harness(result: string = "recorded", rows: FakeRow[] = []) {
  const calls: Record<string, unknown>[] = [];
  const fake = createFakeSupabase({
    tables: { lifecycle_events: rows },
    rpc: {
      record_lifecycle_transition: (args) => {
        calls.push({ ...args });
        return {
          data: [{ result, event_id: result === "recorded" ? "evt-1" : null }],
          error: null,
          count: null
        };
      }
    }
  });
  return { fake, calls, repository: new SupabaseCrmRepository(fake.client, workspace) };
}

describe("the rules run before the database does", () => {
  it("records a move that carries a reason", async () => {
    const { calls, repository } = harness();
    const result = await repository.transitionLifecycle(transition());
    expect(result).toMatchObject({ outcome: "recorded" });
    expect(calls).toHaveLength(1);
  });

  it("refuses a move with no reason codes, without calling the database", async () => {
    // A stage that advanced for no recorded cause cannot be explained to the
    // owner or corrected later, so it must not become a row at all.
    const { calls, repository } = harness();
    const result = await repository.transitionLifecycle(transition({ reasonCodes: [] }));
    expect(result).toMatchObject({ outcome: "refused" });
    expect(calls).toEqual([]);
  });

  it("refuses a move with no actor", async () => {
    const { calls, repository } = harness();
    expect(await repository.transitionLifecycle(transition({ actor: "" }))).toMatchObject({
      outcome: "refused"
    });
    expect(calls).toEqual([]);
  });

  it("refuses retention for a contact that was never a customer", async () => {
    const { calls, repository } = harness();
    const result = await repository.transitionLifecycle(
      transition({ from: "qualified", to: "retention" })
    );
    expect(result).toMatchObject({ outcome: "refused" });
    expect(calls).toEqual([]);
  });

  it("refuses a move to the stage it is already in", async () => {
    const { repository } = harness();
    expect(
      await repository.transitionLifecycle(transition({ from: "engaged", to: "engaged" }))
    ).toMatchObject({ outcome: "refused" });
  });
});

describe("the workspace comes from the server", () => {
  it("passes its own workspace id, never the caller's", async () => {
    const { calls, repository } = harness();
    await repository.transitionLifecycle({
      ...transition(),
      ...({ workspaceId: "someone-else" } as object)
    });
    expect(calls[0]).toMatchObject({ p_workspace_id: WORKSPACE, p_customer_id: CUSTOMER });
  });

  it("sends the stage the caller read, so the database can detect a race", async () => {
    const { calls, repository } = harness();
    await repository.transitionLifecycle(transition({ from: "new", to: "engaged" }));
    expect(calls[0]).toMatchObject({ p_from_stage: "new", p_to_stage: "engaged" });
  });
});

describe("outcomes stay distinguishable", () => {
  it("reports a concurrent move as stale rather than as a failure", async () => {
    // Two operators on one record is ordinary. Throwing here would make it
    // indistinguishable from the database being down.
    const { repository } = harness("stale");
    expect(await repository.transitionLifecycle(transition())).toMatchObject({
      outcome: "stale"
    });
  });

  it("reports a missing customer as a refusal", async () => {
    const { repository } = harness("not_found");
    expect(await repository.transitionLifecycle(transition())).toMatchObject({
      outcome: "refused"
    });
  });

  it("throws on an outcome it does not recognise", async () => {
    // Anything else means the function and this code have drifted apart, and
    // guessing which way would be worse than stopping.
    const { repository } = harness("something_new");
    await expect(repository.transitionLifecycle(transition())).rejects.toThrow(
      "LIFECYCLE_TRANSITION_FAILED"
    );
  });
});

describe("reading the history", () => {
  const event = (over: Partial<FakeRow> = {}): FakeRow => ({
    id: "evt-1",
    workspace_id: WORKSPACE,
    customer_id: CUSTOMER,
    from_stage: "new",
    to_stage: "engaged",
    reason_codes: ["replied_to_first_message"],
    evidence_ref: "msg-1",
    actor: "system",
    occurred_at: "2026-08-20T10:00:00.000Z",
    ...over
  });

  it("returns this customer's stage history", async () => {
    const { repository } = harness("recorded", [event()]);
    expect(await repository.lifecycleFor(CUSTOMER)).toEqual([
      {
        id: "evt-1",
        customerId: CUSTOMER,
        from: "new",
        to: "engaged",
        reasonCodes: ["replied_to_first_message"],
        evidenceRef: "msg-1",
        actor: "system",
        occurredAt: "2026-08-20T10:00:00.000Z"
      }
    ]);
  });

  it("does not return another workspace's history", async () => {
    const { repository } = harness("recorded", [event({ workspace_id: "someone-else" })]);
    expect(await repository.lifecycleFor(CUSTOMER)).toEqual([]);
  });

  it("does not return another customer's history", async () => {
    const { repository } = harness("recorded", [event({ customer_id: "another" })]);
    expect(await repository.lifecycleFor(CUSTOMER)).toEqual([]);
  });

  it("reads a first-ever transition, which has no previous stage", async () => {
    const { repository } = harness("recorded", [event({ from_stage: null })]);
    const [first] = await repository.lifecycleFor(CUSTOMER);
    expect(first?.from).toBeNull();
  });
});
