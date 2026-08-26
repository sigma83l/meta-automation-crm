import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import { SupabaseCrmRepository } from "@/src/modules/crm/adapters/supabase-crm-repository";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import type { FollowUpInput } from "@/src/modules/crm/contracts";
import { defaultCancelCondition, defaultObjective } from "@/src/modules/crm/followup-policy";

/**
 * Storing a follow-up without letting it become a timer.
 *
 * followup-policy.ts has held the rules since the revenue-state work and had no
 * caller. The rules it enforces are only worth anything if the stored row
 * cannot sidestep them, so what these pin is the boundary: nothing lands
 * without an objective and a cancel condition, an owner is either a person or
 * explicitly not one, and a refusal that is not terminal defers rather than
 * cancels.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const USER = "55555555-5555-4555-8555-555555555555";

const workspace: TrustedWorkspace = {
  id: WORKSPACE,
  name: "Probe",
  userId: USER,
  role: "operator"
};

const plan = (over: Partial<FollowUpInput> = {}): FollowUpInput => ({
  customerId: CUSTOMER,
  stopReason: "price_sent",
  dueAt: "2026-08-27T10:00:00.000Z",
  ownerType: "automation",
  ...over
});

const row = (over: Partial<FakeRow> = {}): FakeRow => ({
  id: "f1",
  workspace_id: WORKSPACE,
  customer_id: CUSTOMER,
  stop_reason: "price_sent",
  objective: "diagnose whether the obstacle is affordability or value",
  cancel_condition: "customer declines explicitly or withdraws consent",
  eligibility_state: "eligible",
  message_version: "v1",
  due_at: "2026-08-27T10:00:00.000Z",
  attempts: 0,
  owner_type: "automation",
  owner_id: null,
  last_result: null,
  next_eligible_at: null,
  ...over
});

function harness(rows: FakeRow[] = []) {
  const fake = createFakeSupabase({ tables: { tasks_followups: rows } });
  return { fake, repository: new SupabaseCrmRepository(fake.client, workspace) };
}

describe("scheduling", () => {
  it("fills the objective and cancel condition from the reason", async () => {
    // The columns are NOT NULL and the input leaves them optional. That is only
    // safe because every reason has a specific next step of its own.
    const { repository } = harness();
    const stored = await repository.scheduleFollowUp(plan());
    expect(stored.objective).toBe(defaultObjective("price_sent"));
    expect(stored.cancelCondition).toBe(defaultCancelCondition("price_sent"));
  });

  it("keeps an objective the caller supplied", async () => {
    const { repository } = harness();
    const stored = await repository.scheduleFollowUp(
      plan({ objective: "confirm the quote reached them" })
    );
    expect(stored.objective).toBe("confirm the quote reached them");
  });

  it("refuses a blank objective rather than falling back to the default", async () => {
    // A blank string satisfies the type and would quietly become the default,
    // which hides that the caller meant to say something and did not.
    const { fake, repository } = harness();
    await expect(repository.scheduleFollowUp(plan({ objective: "   " }))).rejects.toThrow();
    expect(fake.database.rows("tasks_followups")).toEqual([]);
  });

  it("requires an owner id for a human owner", async () => {
    const { repository } = harness();
    await expect(repository.scheduleFollowUp(plan({ ownerType: "human" }))).rejects.toThrow();
  });

  it("refuses an owner id on an owner that is not a person", async () => {
    // An automation recorded as a person is how a queue fills with tasks nobody
    // assigned themselves.
    const { repository } = harness();
    await expect(
      repository.scheduleFollowUp(plan({ ownerType: "automation", ownerId: USER }))
    ).rejects.toThrow();
  });

  it("accepts a human owner with an id", async () => {
    const { repository } = harness();
    const stored = await repository.scheduleFollowUp(plan({ ownerType: "human", ownerId: USER }));
    expect(stored).toMatchObject({ ownerType: "human", ownerId: USER });
  });

  it("takes the workspace from the server", async () => {
    const { fake, repository } = harness();
    await repository.scheduleFollowUp({ ...plan(), ...({ workspaceId: "elsewhere" } as object) });
    expect(fake.database.rows("tasks_followups")[0]).toMatchObject({ workspace_id: WORKSPACE });
  });
});

describe("the due sweep", () => {
  it("returns an eligible follow-up that is due", async () => {
    const { repository } = harness([row()]);
    expect(await repository.dueFollowUps("2026-08-27T11:00:00.000Z")).toHaveLength(1);
  });

  it("does not return one that is not due yet", async () => {
    const { repository } = harness([row()]);
    expect(await repository.dueFollowUps("2026-08-27T09:00:00.000Z")).toEqual([]);
  });

  it("does not return a cancelled follow-up", async () => {
    const { repository } = harness([row({ eligibility_state: "cancelled" })]);
    expect(await repository.dueFollowUps("2026-08-27T11:00:00.000Z")).toEqual([]);
  });

  it("does not return another workspace's follow-up", async () => {
    const { repository } = harness([row({ workspace_id: "elsewhere" })]);
    expect(await repository.dueFollowUps("2026-08-27T11:00:00.000Z")).toEqual([]);
  });
});

describe("settling an execution-time verdict", () => {
  it("cancels on a terminal refusal", async () => {
    // The customer opted out. This one must never come back.
    const { repository } = harness([row()]);
    const settled = await repository.settleFollowUp("f1", {
      eligible: false,
      reason: "customer opted out",
      terminal: true
    });
    expect(settled.eligibilityState).toBe("cancelled");
    expect(settled.lastResult).toBe("customer opted out");
  });

  it("defers rather than cancels on a refusal that can clear", async () => {
    // A human owning the conversation is temporary. Cancelling would throw away
    // a follow-up that is still wanted.
    const { repository } = harness([row()]);
    const settled = await repository.settleFollowUp(
      "f1",
      { eligible: false, reason: "conversation owned by a human", terminal: false },
      "2026-08-28T10:00:00.000Z"
    );
    expect(settled.eligibilityState).toBe("eligible");
    expect(settled.nextEligibleAt).toBe("2026-08-28T10:00:00.000Z");
  });

  it("leaves a deferred follow-up out of the sweep until its time comes", async () => {
    const { repository } = harness([row({ next_eligible_at: "2026-08-28T10:00:00.000Z" })]);
    expect(await repository.dueFollowUps("2026-08-27T11:00:00.000Z")).toEqual([]);
    expect(await repository.dueFollowUps("2026-08-28T11:00:00.000Z")).toHaveLength(1);
  });

  it("leaves an eligible verdict eligible", async () => {
    const { repository } = harness([row()]);
    const settled = await repository.settleFollowUp("f1", { eligible: true });
    expect(settled.eligibilityState).toBe("eligible");
  });
});

describe("attempts", () => {
  it("counts an attempt and records what came of it", async () => {
    // attempts alone is a number with no story: three that failed to send and
    // three that were delivered and ignored would be the same row.
    const { repository } = harness([row({ attempts: 1 })]);
    const after = await repository.recordFollowUpAttempt("f1", "delivered, no reply");
    expect(after).toMatchObject({ attempts: 2, lastResult: "delivered, no reply" });
  });

  it("refuses to touch a follow-up in another workspace", async () => {
    const { repository } = harness([row({ workspace_id: "elsewhere" })]);
    await expect(repository.recordFollowUpAttempt("f1", "delivered")).rejects.toThrow(
      "FOLLOWUP_NOT_FOUND"
    );
  });
});
