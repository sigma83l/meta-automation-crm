import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import type {
  CrmRepository,
  CustomerFilters,
  CustomerInput,
  CustomerSummary,
  EvidenceInput,
  StoredEvidence,
  FollowUpInput,
  FollowUpOwner,
  StoredFollowUp,
  StoredLifecycleEvent,
  TransitionInput,
  TransitionResult
} from "../contracts";
import { FOLLOWUP_OWNERS } from "../contracts";
import {
  STOP_REASONS,
  defaultCancelCondition,
  defaultObjective,
  type EligibilityVerdict
} from "../followup-policy";
import { authorizeLifecycleTransition, type LifecycleStage } from "../revenue-state";

const inputSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  companyName: z.string().trim().min(1).max(120).nullable().optional(),
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().min(3).max(40).optional()
});

// Bounds mirror the table's own check constraints, so a bad weight is refused
// before a round trip rather than as a Postgres error the caller has to parse.
// `evidenceRef` is min(1) where the column is merely nullable: the column
// predates the rule that every non-zero contribution names its source, and this
// is the boundary that now enforces it.
// Objective and cancelCondition are optional here and NOT NULL in the table.
// That is not a loosening: `defaultObjective` supplies a specific next step for
// every reason, so the column is always filled. What the caller cannot do is
// pass an empty one - `.min(1)` refuses the blank string that would satisfy the
// type and turn the row back into a timer.
const followUpSchema = z
  .object({
    customerId: z.string().uuid(),
    stopReason: z.enum(STOP_REASONS),
    objective: z.string().trim().min(1).max(200).optional(),
    cancelCondition: z.string().trim().min(1).max(200).optional(),
    dueAt: z.string().datetime(),
    ownerType: z.enum(FOLLOWUP_OWNERS),
    ownerId: z.string().uuid().nullable().optional(),
    messageVersion: z.string().trim().min(1).max(40).optional()
  })
  // Mirrors the table's owner-identity constraint so the caller gets a usable
  // error rather than a Postgres one, and so an automation cannot be recorded
  // as a person.
  .refine((input) => (input.ownerType === "human") === Boolean(input.ownerId), {
    message: "a human owner needs an owner id, and only a human owner may have one"
  });

const evidenceSchema = z.object({
  customerId: z.string().uuid(),
  signal: z.string().trim().min(1).max(80),
  weight: z.number().int().min(-100).max(100),
  confidence: z.enum(["inferred", "high_confidence", "confirmed", "human_verified"]),
  evidenceRef: z.string().trim().min(1).max(200)
});

export class SupabaseCrmRepository implements CrmRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly workspace: TrustedWorkspace
  ) {}

  async list(filters: CustomerFilters) {
    let query = this.client
      .from("customers")
      .select("id,display_name,company_name,status,source,created_at")
      .eq("workspace_id", this.workspace.id)
      .order("updated_at", { ascending: false })
      .limit(250);
    if (filters.query) {
      const safe = filters.query.replaceAll(/[,%()]/g, "").slice(0, 80);
      query = query.or(`display_name.ilike.%${safe}%,company_name.ilike.%${safe}%`);
    }
    if (filters.status) query = query.eq("status", filters.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(mapCustomer);
  }

  async create(raw: CustomerInput) {
    const input = inputSchema.parse(raw);
    const { data, error } = await this.client
      .from("customers")
      .insert({
        workspace_id: this.workspace.id,
        display_name: input.displayName,
        company_name: input.companyName ?? null,
        created_by: this.workspace.userId
      })
      .select("id,display_name,company_name,status,source,created_at")
      .single();
    if (error) throw error;
    const contacts = [
      ...(input.email ? [{ kind: "email", value: input.email, is_primary: true }] : []),
      ...(input.phone ? [{ kind: "phone", value: input.phone, is_primary: !input.email }] : [])
    ];
    if (contacts.length) {
      const { error: contactError } = await this.client.from("customer_contact_methods").insert(
        contacts.map((contact) => ({
          ...contact,
          workspace_id: this.workspace.id,
          customer_id: data.id
        }))
      );
      if (contactError) {
        await this.client.from("customers").delete().eq("id", data.id);
        throw contactError;
      }
    }
    await this.activity(data.id, "customer.created", `Customer ${input.displayName} created`);
    await this.audit(data.id, "crm.customer.created");
    return mapCustomer(data);
  }

  async update(customerId: string, raw: CustomerInput) {
    const input = inputSchema.parse(raw);
    const { data, error } = await this.client
      .from("customers")
      .update({
        display_name: input.displayName,
        company_name: input.companyName ?? null,
        updated_at: new Date().toISOString()
      })
      .eq("workspace_id", this.workspace.id)
      .eq("id", customerId)
      .select("id,display_name,company_name,status,source,created_at")
      .single();
    if (error) throw error;
    await this.activity(customerId, "customer.updated", `Customer ${input.displayName} updated`);
    await this.audit(customerId, "crm.customer.updated");
    return mapCustomer(data);
  }

  async detail(customerId: string): Promise<Readonly<Record<string, unknown>>> {
    const customer = await this.client
      .from("customers")
      .select("*")
      .eq("workspace_id", this.workspace.id)
      .eq("id", customerId)
      .single();
    if (customer.error) throw customer.error;
    const tables = [
      "customer_channel_identities",
      "customer_contact_methods",
      "customer_consents",
      "customer_notes",
      "customer_activities",
      "conversations",
      "customer_files",
      "customer_automation_references",
      "crm_audit_events"
    ] as const;
    const results = await Promise.all(
      tables.map((table) =>
        this.client
          .from(table)
          .select("*")
          .eq("workspace_id", this.workspace.id)
          .eq("customer_id", customerId)
      )
    );
    return Object.freeze({
      customer: customer.data,
      identities: results[0]!.data ?? [],
      contacts: results[1]!.data ?? [],
      consents: results[2]!.data ?? [],
      notes: results[3]!.data ?? [],
      timeline: results[4]!.data ?? [],
      conversations: results[5]!.data ?? [],
      files: results[6]!.data ?? [],
      automations: results[7]!.data ?? [],
      audit: results[8]!.data ?? []
    });
  }

  async recordEvidence(raw: EvidenceInput): Promise<StoredEvidence> {
    const input = evidenceSchema.parse(raw);
    const { data, error } = await this.client
      .from("qualification_evidence")
      .insert({
        workspace_id: this.workspace.id,
        customer_id: input.customerId,
        signal: input.signal,
        weight: input.weight,
        confidence: input.confidence,
        evidence_ref: input.evidenceRef
      })
      .select("id,customer_id,signal,weight,confidence,evidence_ref,recorded_at")
      .single();
    // Thrown, not swallowed. Evidence is what a score is answerable for, so a
    // score computed over evidence that silently failed to store would be a
    // number nobody could reconstruct - the exact failure the table exists to
    // prevent.
    if (error || !data) throw new Error("EVIDENCE_WRITE_FAILED");
    return mapEvidence(data);
  }

  async evidenceFor(customerId: string): Promise<readonly StoredEvidence[]> {
    const { data, error } = await this.client
      .from("qualification_evidence")
      .select("id,customer_id,signal,weight,confidence,evidence_ref,recorded_at")
      .eq("workspace_id", this.workspace.id)
      .eq("customer_id", customerId)
      .order("recorded_at", { ascending: false });
    if (error) throw new Error("EVIDENCE_READ_FAILED");
    // A row with no evidence_ref cannot have come from recordEvidence, but the
    // column is nullable and this table is older than that rule. Dropping such a
    // row is the safe reading: it would otherwise contribute weight that nothing
    // can justify.
    return (data ?? []).filter((row) => row.evidence_ref).map(mapEvidence);
  }

  async transitionLifecycle(input: TransitionInput): Promise<TransitionResult> {
    // Decided here, committed there. The rules are already implemented and
    // tested as a pure function; what the database adds is that the stage and
    // the reason for it cannot end up disagreeing.
    const verdict = authorizeLifecycleTransition({
      from: input.from,
      to: input.to,
      reasonCodes: input.reasonCodes,
      ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
      actor: input.actor
    });
    if (!verdict.allowed) return { outcome: "refused", reason: verdict.reason };

    const { data, error } = await this.client.rpc("record_lifecycle_transition", {
      p_workspace_id: this.workspace.id,
      p_customer_id: input.customerId,
      p_from_stage: input.from,
      p_to_stage: input.to,
      p_reason_codes: [...input.reasonCodes],
      p_evidence_ref: input.evidenceRef ?? null,
      p_actor: input.actor
    });
    if (error) throw new Error("LIFECYCLE_TRANSITION_FAILED");

    const row = (Array.isArray(data) ? data[0] : data) as
      { result?: string; event_id?: string } | null | undefined;
    // A customer the caller cannot see and one that does not exist are the same
    // answer on purpose: the function is workspace-scoped, so distinguishing
    // them would confirm a row exists in a tenant the caller has no access to.
    if (row?.result === "not_found") return { outcome: "refused", reason: "customer not found" };
    if (row?.result === "stale") {
      return { outcome: "stale", reason: "the stage changed since it was read" };
    }
    if (row?.result !== "recorded" || !row.event_id) {
      throw new Error("LIFECYCLE_TRANSITION_FAILED");
    }

    return {
      outcome: "recorded",
      event: {
        id: String(row.event_id),
        customerId: input.customerId,
        from: input.from,
        to: input.to,
        reasonCodes: input.reasonCodes,
        evidenceRef: input.evidenceRef ?? null,
        actor: input.actor,
        occurredAt: new Date().toISOString()
      }
    };
  }

  async lifecycleFor(customerId: string): Promise<readonly StoredLifecycleEvent[]> {
    const { data, error } = await this.client
      .from("lifecycle_events")
      .select("id,customer_id,from_stage,to_stage,reason_codes,evidence_ref,actor,occurred_at")
      .eq("workspace_id", this.workspace.id)
      .eq("customer_id", customerId)
      .order("occurred_at", { ascending: false });
    if (error) throw new Error("LIFECYCLE_READ_FAILED");
    return (data ?? []).map((row) => ({
      id: String(row.id),
      customerId: String(row.customer_id),
      from: (row.from_stage as LifecycleStage | null) ?? null,
      to: row.to_stage as LifecycleStage,
      reasonCodes: (row.reason_codes as string[] | null) ?? [],
      evidenceRef: (row.evidence_ref as string | null) ?? null,
      actor: String(row.actor),
      occurredAt: String(row.occurred_at)
    }));
  }

  async scheduleFollowUp(raw: FollowUpInput): Promise<StoredFollowUp> {
    const input = followUpSchema.parse(raw);
    const { data, error } = await this.client
      .from("tasks_followups")
      .insert({
        workspace_id: this.workspace.id,
        customer_id: input.customerId,
        stop_reason: input.stopReason,
        objective: input.objective ?? defaultObjective(input.stopReason),
        cancel_condition: input.cancelCondition ?? defaultCancelCondition(input.stopReason),
        due_at: input.dueAt,
        owner_type: input.ownerType,
        owner_id: input.ownerId ?? null,
        message_version: input.messageVersion ?? "v1"
      })
      .select(FOLLOWUP_COLUMNS)
      .single();
    if (error || !data) throw new Error("FOLLOWUP_WRITE_FAILED");
    return mapFollowUp(data);
  }

  async dueFollowUps(now: string): Promise<readonly StoredFollowUp[]> {
    const { data, error } = await this.client
      .from("tasks_followups")
      .select(FOLLOWUP_COLUMNS)
      .eq("workspace_id", this.workspace.id)
      .eq("eligibility_state", "eligible")
      .lte("due_at", now)
      // A deferred row is still eligible - the condition that blocked it can
      // clear - but it is not due until its deferral passes. `or` rather than a
      // plain comparison because a row that was never deferred has none.
      .or(`next_eligible_at.is.null,next_eligible_at.lte.${now}`)
      .order("due_at", { ascending: true });
    if (error) throw new Error("FOLLOWUP_READ_FAILED");
    return (data ?? []).map(mapFollowUp);
  }

  async settleFollowUp(
    followUpId: string,
    verdict: EligibilityVerdict,
    deferUntil?: string
  ): Promise<StoredFollowUp> {
    // Eligible stays eligible: this is the execution-time check saying go
    // ahead, not a state change.
    const patch = verdict.eligible
      ? { eligibility_state: "eligible" as const }
      : verdict.terminal
        ? { eligibility_state: "cancelled" as const, last_result: verdict.reason }
        : {
            // Not terminal. The follow-up is still wanted and the blocker can
            // clear, so it keeps its eligible state and is pushed out instead.
            eligibility_state: "eligible" as const,
            last_result: verdict.reason,
            ...(deferUntil ? { next_eligible_at: deferUntil } : {})
          };
    return this.patchFollowUp(followUpId, patch);
  }

  async recordFollowUpAttempt(followUpId: string, result: string): Promise<StoredFollowUp> {
    const current = await this.client
      .from("tasks_followups")
      .select("attempts")
      .eq("workspace_id", this.workspace.id)
      .eq("id", followUpId)
      .maybeSingle();
    if (current.error || !current.data) throw new Error("FOLLOWUP_NOT_FOUND");
    return this.patchFollowUp(followUpId, {
      attempts: Number(current.data.attempts ?? 0) + 1,
      last_result: result.slice(0, 200)
    });
  }

  private async patchFollowUp(
    followUpId: string,
    patch: Record<string, unknown>
  ): Promise<StoredFollowUp> {
    const { data, error } = await this.client
      .from("tasks_followups")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("workspace_id", this.workspace.id)
      .eq("id", followUpId)
      .select(FOLLOWUP_COLUMNS)
      .single();
    if (error || !data) throw new Error("FOLLOWUP_NOT_FOUND");
    return mapFollowUp(data);
  }

  private async activity(customerId: string, activityType: string, summary: string) {
    const { error } = await this.client.from("customer_activities").insert({
      workspace_id: this.workspace.id,
      customer_id: customerId,
      activity_type: activityType,
      summary
    });
    if (error) throw error;
  }

  private async audit(customerId: string, action: string) {
    const { error } = await this.client.from("crm_audit_events").insert({
      workspace_id: this.workspace.id,
      actor_user_id: this.workspace.userId,
      customer_id: customerId,
      action
    });
    if (error) throw error;
  }
}

// One literal rather than a concatenation: supabase-js infers the row type from
// the select string, and `"a" + "b"` widens to `string`, which loses it.
const FOLLOWUP_COLUMNS =
  "id,customer_id,stop_reason,objective,cancel_condition,eligibility_state,message_version,due_at,attempts,owner_type,owner_id,last_result,next_eligible_at" as const;

function mapFollowUp(row: Record<string, unknown>): StoredFollowUp {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    stopReason: row.stop_reason as StoredFollowUp["stopReason"],
    objective: String(row.objective),
    cancelCondition: String(row.cancel_condition),
    eligibilityState: row.eligibility_state as StoredFollowUp["eligibilityState"],
    messageVersion: String(row.message_version),
    dueAt: String(row.due_at),
    attempts: Number(row.attempts ?? 0),
    ownerType: row.owner_type as FollowUpOwner,
    ownerId: (row.owner_id as string | null) ?? null,
    lastResult: (row.last_result as string | null) ?? null,
    nextEligibleAt: (row.next_eligible_at as string | null) ?? null
  };
}

function mapEvidence(row: Record<string, unknown>): StoredEvidence {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    signal: String(row.signal),
    weight: Number(row.weight),
    confidence: row.confidence as StoredEvidence["confidence"],
    evidenceRef: String(row.evidence_ref),
    recordedAt: String(row.recorded_at)
  };
}

function mapCustomer(row: Record<string, unknown>): CustomerSummary {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    companyName: row.company_name ? String(row.company_name) : null,
    status: row.status as "active" | "archived",
    source: String(row.source),
    createdAt: String(row.created_at)
  };
}
