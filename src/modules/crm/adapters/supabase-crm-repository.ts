import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  assertWorkspaceManager,
  assertWorkspaceOperator,
  type TrustedWorkspace
} from "@/src/modules/workspaces/server/resolve-workspace";
import type {
  CrmRepository,
  CustomerFilters,
  CustomerInput,
  CustomerSummary,
  EvidenceInput,
  StoredEvidence,
  FieldDefinitionInput,
  FieldValueInput,
  FieldWriteResult,
  StoredFieldDefinition,
  StoredFieldValue,
  FollowUpInput,
  FollowUpOwner,
  OpportunityInput,
  OutcomeInput,
  OutcomeResult,
  StoredOpportunity,
  StoredFollowUp,
  ScoreConfigInput,
  ScoreConfigResult,
  ActionProposalInput,
  AiWriteOutcome,
  RadarCursor,
  RadarPage,
  RadarQuery,
  RadarRow,
  SavedView,
  SavedViewInput,
  StoredActionProposal,
  StoredScoreConfig,
  StoredScoreSnapshot,
  StoredLifecycleEvent,
  TransitionInput,
  TransitionResult
} from "../contracts";
import { FOLLOWUP_OWNERS } from "../contracts";
import {
  AI_WRITE_PERMISSIONS,
  FIELD_TYPES,
  FIELD_WRITERS,
  authorizeFieldWrite,
  type AiWritePermission,
  type FieldConfidence,
  type FieldType,
  type FieldWriter
} from "../custom-field-policy";
import {
  STOP_REASONS,
  defaultCancelCondition,
  defaultObjective,
  type EligibilityVerdict
} from "../followup-policy";
import {
  OUTCOME_SOURCES,
  OPPORTUNITY_STAGES,
  authorizeOutcome,
  type OpportunityStage,
  type OutcomeSource
} from "../opportunity-outcome";
import { rankAttention, type AttentionVerdict } from "../attention-priority";
import {
  ACTION_ELIGIBILITY,
  ACTION_OWNERS,
  NEXT_ACTION_TYPES,
  proposeNextAction,
  type ActionEligibility,
  type ActionOwner,
  type ActionSource,
  type NextActionState,
  type NextActionType
} from "../next-action";
import { buildNowCard, type NowCard } from "../now-card";
import { assertFeatureEnabled } from "@/src/modules/features/server/gate";
import { classifyProposal, evidenceKey, summariseProposal, type AiCrmProposal } from "../ai-write";
import {
  buildTimeline,
  filterTimeline,
  type TimelineEvent,
  type TimelineFilter
} from "../timeline";
import {
  DEFAULT_SCORE_CONFIG,
  EVIDENCE_COMPONENTS,
  SCORE_COMPONENTS,
  computeScore,
  validateScoreConfig,
  type EvidenceComponent,
  type ScoreBlocker,
  type ScoreConfig,
  type ScoreDriver,
  type ScoredEvidence
} from "../qualification-score";
import { ATTENTION_FILTERS, matchesAttention } from "../radar-views";
import {
  LEAD_STATUSES,
  LIFECYCLE_STAGES,
  authorizeLifecycleTransition,
  type LeadStatus,
  type LifecycleStage
} from "../revenue-state";
import type { FactConfidence, ProposedFact, StoredFact } from "@/src/modules/rcos/memory-policy";
import { CONTACT_FACTS_CONFLICT } from "../ai-write";

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

const opportunitySchema = z.object({
  customerId: z.string().uuid(),
  valueBand: z.enum(["unknown", "low", "medium", "high"]).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  nextAction: z.string().trim().min(1).max(200).nullable().optional()
});

const outcomeSchema = z.object({
  stage: z.enum(OPPORTUNITY_STAGES),
  source: z.enum(OUTCOME_SOURCES),
  evidenceRef: z.string().trim().min(1).max(200).nullable().optional(),
  lostReason: z.string().trim().min(1).max(200).nullable().optional()
});

const fieldDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  // Mirrors the column's own pattern so a bad key is refused before a round
  // trip. The key is what every stored value joins on, so it is deliberately
  // narrower than the name beside it.
  fieldKey: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,63}$/, "lowercase, starting with a letter"),
  fieldType: z.enum(FIELD_TYPES),
  aiWrite: z.enum(AI_WRITE_PERMISSIONS).optional()
});

const fieldValueSchema = z.object({
  customerId: z.string().uuid(),
  fieldKey: z.string().trim().min(1).max(64),
  // The type is checked against the definition, which is only known after the
  // lookup; this is the outer bound of what jsonb will hold at all.
  value: z.union([z.string().trim().min(1).max(500), z.number(), z.boolean()]),
  writer: z.enum(FIELD_WRITERS),
  authoritative: z.boolean().optional(),
  sourceRef: z.string().trim().min(1).max(200)
});

const evidenceSchema = z.object({
  customerId: z.string().uuid(),
  signal: z.string().trim().min(1).max(80),
  component: z.enum(EVIDENCE_COMPONENTS),
  weight: z.number().int().min(-100).max(100),
  confidence: z.enum(["inferred", "high_confidence", "confirmed", "human_verified"]),
  evidenceRef: z.string().trim().min(1).max(200),
  expiresAt: z.string().datetime().nullable().optional()
});

const proposalSchema = z
  .object({
    customerId: z.string().uuid(),
    type: z.enum(NEXT_ACTION_TYPES),
    reasonCodes: z.array(z.string().trim().min(1).max(60)).max(20),
    evidenceRefs: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    ownerType: z.enum(ACTION_OWNERS),
    ownerId: z.string().uuid().nullable().optional(),
    dueAt: z.string().datetime().nullable().optional(),
    eligibility: z.enum(ACTION_ELIGIBILITY).optional(),
    confidence: z.number().min(0).max(1).optional(),
    // 'derived' is refused here rather than merely unused. A derived action is
    // recomputed on every read, so storing one would create a second answer
    // that can disagree with the live one.
    source: z.enum(["ai", "human"])
  })
  .refine((input) => (input.ownerType === "human") === Boolean(input.ownerId), {
    message: "a human owner needs an owner id, and only a human owner may have one"
  });

const savedViewSchema = z.object({
  name: z.string().trim().min(1).max(60),
  filters: z
    .object({
      status: z.enum(["active", "archived"]).optional(),
      lifecycleStage: z.enum(LIFECYCLE_STAGES).optional(),
      leadStatus: z.enum(LEAD_STATUSES).optional(),
      attention: z.enum(ATTENTION_FILTERS).optional(),
      activeWithinDays: z.number().int().min(1).max(365).optional()
    })
    // The same rule the table states, so the refusal names the problem instead
    // of arriving as a constraint violation.
    .refine((filters) => Object.values(filters).some((value) => value !== undefined), {
      message: "a saved view needs at least one filter"
    })
});

const scoreConfigSchema = z.object({
  version: z.string().trim().min(1).max(60),
  components: z.record(z.enum(SCORE_COMPONENTS), z.number().int().min(0).max(100)),
  disqualifierMin: z.number().int().min(-100).max(0).optional()
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
        component: input.component,
        confidence: input.confidence,
        evidence_ref: input.evidenceRef,
        expires_at: input.expiresAt ?? null
      })
      .select(EVIDENCE_COLUMNS)
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
      .select(EVIDENCE_COLUMNS)
      .eq("workspace_id", this.workspace.id)
      .eq("customer_id", customerId)
      .order("recorded_at", { ascending: false });
    if (error) throw new Error("EVIDENCE_READ_FAILED");
    // A row missing either column cannot have come from recordEvidence, but
    // both are nullable and this table is older than the rules requiring them.
    // Dropping such a row is the safe reading: it would otherwise contribute
    // weight that nothing can justify, or land in a component nobody chose.
    return (data ?? []).filter((row) => row.evidence_ref && row.component).map(mapEvidence);
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

  async openOpportunity(raw: OpportunityInput): Promise<StoredOpportunity> {
    const input = opportunitySchema.parse(raw);
    // Deliberately no stage argument. An opportunity that could be created
    // already won would route around every check settleOpportunity performs.
    const { data, error } = await this.client
      .from("opportunities")
      .insert({
        workspace_id: this.workspace.id,
        customer_id: input.customerId,
        stage: "open",
        value_band: input.valueBand ?? "unknown",
        owner_id: input.ownerId ?? null,
        next_action: input.nextAction ?? null
      })
      .select(OPPORTUNITY_COLUMNS)
      .single();
    if (error || !data) throw new Error("OPPORTUNITY_WRITE_FAILED");
    return mapOpportunity(data);
  }

  async opportunitiesFor(customerId: string): Promise<readonly StoredOpportunity[]> {
    const { data, error } = await this.client
      .from("opportunities")
      .select(OPPORTUNITY_COLUMNS)
      .eq("workspace_id", this.workspace.id)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("OPPORTUNITY_READ_FAILED");
    return (data ?? []).map(mapOpportunity);
  }

  async settleOpportunity(opportunityId: string, raw: OutcomeInput): Promise<OutcomeResult> {
    const claim = outcomeSchema.parse(raw);
    // Rebuilt rather than spread: exactOptionalPropertyTypes distinguishes an
    // absent key from one holding undefined, and Zod's optional() produces the
    // latter.
    const verdict = authorizeOutcome({
      stage: claim.stage,
      source: claim.source,
      evidenceRef: claim.evidenceRef ?? null,
      lostReason: claim.lostReason ?? null
    });
    if (!verdict.allowed) return { outcome: "refused", reason: verdict.reason };

    const settled = claim.stage === "won" || claim.stage === "lost";
    const { data, error } = await this.client
      .from("opportunities")
      .update({
        stage: claim.stage,
        lost_reason: claim.lostReason ?? null,
        // Reopening clears the provenance rather than keeping a stale claim
        // attached to a stage that no longer makes it.
        outcome_source: settled ? claim.source : null,
        outcome_evidence_ref: settled ? (claim.evidenceRef ?? null) : null,
        outcome_recorded_at: settled ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      })
      .eq("workspace_id", this.workspace.id)
      .eq("id", opportunityId)
      .select(OPPORTUNITY_COLUMNS)
      .single();
    if (error || !data) throw new Error("OPPORTUNITY_NOT_FOUND");
    return { outcome: "recorded", opportunity: mapOpportunity(data) };
  }

  async defineCustomField(raw: FieldDefinitionInput): Promise<StoredFieldDefinition> {
    // Defining a field, not reading or filling one. A workspace whose custom
    // fields were switched off keeps every definition it already made and every
    // value stored against them — withdrawing those would hide data the
    // workspace entered itself, which no entitlement decision should do.
    await assertFeatureEnabled(this.client, this.workspace.id, "custom_fields");
    const input = fieldDefinitionSchema.parse(raw);
    const { data, error } = await this.client
      .from("custom_field_definitions")
      .insert({
        workspace_id: this.workspace.id,
        name: input.name,
        field_key: input.fieldKey,
        field_type: input.fieldType,
        // Closed unless the caller opens it. A field defined without an opinion
        // is one nobody considered, and no is the safe reading of silence.
        ai_write: input.aiWrite ?? "never"
      })
      .select(FIELD_DEFINITION_COLUMNS)
      .single();
    if (error || !data) throw new Error("FIELD_DEFINITION_WRITE_FAILED");
    return mapFieldDefinition(data);
  }

  async customFieldDefinitions(): Promise<readonly StoredFieldDefinition[]> {
    const { data, error } = await this.client
      .from("custom_field_definitions")
      .select(FIELD_DEFINITION_COLUMNS)
      .eq("workspace_id", this.workspace.id)
      .order("field_key");
    if (error) throw new Error("FIELD_DEFINITION_READ_FAILED");
    return (data ?? []).map(mapFieldDefinition);
  }

  async setCustomFieldValue(raw: FieldValueInput): Promise<FieldWriteResult> {
    const input = fieldValueSchema.parse(raw);

    const { data: definitionRow, error: definitionError } = await this.client
      .from("custom_field_definitions")
      .select(FIELD_DEFINITION_COLUMNS)
      .eq("workspace_id", this.workspace.id)
      .eq("field_key", input.fieldKey)
      .maybeSingle();
    if (definitionError) throw new Error("FIELD_DEFINITION_READ_FAILED");
    // An undefined field is refused rather than created. A write that defines
    // its own field would let a model invent the schema it then fills in.
    if (!definitionRow) {
      return { outcome: "refused", reason: `${input.fieldKey} is not a defined field` };
    }
    const definition = mapFieldDefinition(definitionRow);

    const verdict = authorizeFieldWrite(
      {
        fieldKey: definition.fieldKey,
        fieldType: definition.fieldType,
        aiWrite: definition.aiWrite
      },
      {
        value: input.value,
        writer: input.writer,
        authoritative: input.authoritative ?? false,
        sourceRef: input.sourceRef
      }
    );
    if (verdict.outcome === "refused") return { outcome: "refused", reason: verdict.reason };
    if (verdict.outcome === "suggest") return { outcome: "suggested", reason: verdict.reason };

    const updatedAt = new Date().toISOString();
    const { data, error } = await this.client
      .from("customer_custom_field_values")
      .upsert(
        {
          workspace_id: this.workspace.id,
          customer_id: input.customerId,
          definition_id: definition.id,
          value: input.value,
          written_by: input.writer,
          confidence: verdict.confidence,
          source_ref: input.sourceRef,
          updated_at: updatedAt
        },
        { onConflict: "workspace_id,customer_id,definition_id" }
      )
      .select(FIELD_VALUE_COLUMNS)
      .single();
    if (error || !data) throw new Error("FIELD_VALUE_WRITE_FAILED");
    return { outcome: "stored", value: mapFieldValue(data, definition.fieldKey) };
  }

  async customFieldValuesFor(customerId: string): Promise<readonly StoredFieldValue[]> {
    // Two queries rather than an embed. Values are keyed by definition id and
    // callers want the field key, and a workspace's definition list is bounded
    // by how many fields an operator has made - so this is one small extra read
    // rather than a per-row one, and it does not rest on PostgREST's embedding
    // shape, which differs between a single row and a collection.
    const definitions = await this.customFieldDefinitions();
    const keys = new Map(definitions.map((definition) => [definition.id, definition.fieldKey]));

    const { data, error } = await this.client
      .from("customer_custom_field_values")
      .select(FIELD_VALUE_COLUMNS)
      .eq("workspace_id", this.workspace.id)
      .eq("customer_id", customerId);
    if (error) throw new Error("FIELD_VALUE_READ_FAILED");
    return (data ?? []).map((row: Record<string, unknown>) =>
      mapFieldValue(row, keys.get(String(row.definition_id)) ?? "")
    );
  }

  async saveScoreConfig(raw: ScoreConfigInput): Promise<ScoreConfigResult> {
    const input = scoreConfigSchema.parse(raw);
    const candidate: ScoreConfig = {
      version: input.version,
      components: input.components as ScoreConfig["components"],
      disqualifierMin: input.disqualifierMin ?? DEFAULT_SCORE_CONFIG.disqualifierMin
    };
    // Refused rather than thrown: unusable weights are an operator mistake with
    // a correction, not a fault. The message names the total so the person who
    // typed it can see what is wrong.
    const verdict = validateScoreConfig(candidate);
    if (!verdict.valid) return { outcome: "refused", reason: verdict.reason };

    const { data, error } = await this.client
      .from("crm_score_configs")
      .insert({
        workspace_id: this.workspace.id,
        version: candidate.version,
        components: candidate.components,
        disqualifier_min: candidate.disqualifierMin,
        created_by: this.workspace.userId
      })
      .select(SCORE_CONFIG_COLUMNS)
      .single();
    // A duplicate version is the common failure and the table refuses it, which
    // is the point: a version names one set of weights permanently.
    if (error || !data)
      return { outcome: "refused", reason: `${candidate.version} already exists` };
    return { outcome: "stored", config: mapScoreConfig(data) };
  }

  async activeScoreConfig(): Promise<ScoreConfig> {
    const { data, error } = await this.client
      .from("crm_score_configs")
      .select(SCORE_CONFIG_COLUMNS)
      .eq("workspace_id", this.workspace.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("SCORE_CONFIG_READ_FAILED");
    // A workspace that has never customised its weights scores against the
    // pack's V1 defaults. Falling back to them by name means an early snapshot
    // still cites a version that says exactly how it was computed.
    if (!data) return DEFAULT_SCORE_CONFIG;
    const stored = mapScoreConfig(data);
    return {
      version: stored.version,
      components: stored.components,
      disqualifierMin: stored.disqualifierMin
    };
  }

  async rescoreCustomer(customerId: string, now: Date = new Date()): Promise<StoredScoreSnapshot> {
    const [config, evidence] = await Promise.all([
      this.activeScoreConfig(),
      this.evidenceFor(customerId)
    ]);
    const computed = computeScore(evidence.map(toScoredEvidence), config, now);
    return this.writeSnapshot(customerId, computed.score, computed, null, null);
  }

  async latestScore(customerId: string): Promise<StoredScoreSnapshot | null> {
    const { data, error } = await this.client
      .from("crm_score_snapshots")
      .select(SNAPSHOT_COLUMNS)
      .eq("workspace_id", this.workspace.id)
      .eq("customer_id", customerId)
      .order("calculated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("SCORE_SNAPSHOT_READ_FAILED");
    return data ? mapSnapshot(data) : null;
  }

  async overrideScore(
    customerId: string,
    score: number,
    reason: string,
    now: Date = new Date()
  ): Promise<StoredScoreSnapshot> {
    // Overriding is overruling the evidence, which is the one escape hatch from
    // the discipline this whole engine exists to impose. Manager rather than
    // operator for that reason, and it throws rather than refusing because a
    // viewer reaching this line is a bug in the caller, not a bad input.
    assertWorkspaceManager(this.workspace);
    const trimmed = reason.trim();
    if (!trimmed) throw new Error("SCORE_OVERRIDE_REASON_REQUIRED");
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      throw new Error("SCORE_OVERRIDE_OUT_OF_RANGE");
    }

    const [config, evidence] = await Promise.all([
      this.activeScoreConfig(),
      this.evidenceFor(customerId)
    ]);
    // The components stay as the evidence computed them while the total is the
    // person's. Keeping both is the point: the snapshot shows the gap between
    // what the evidence supported and what somebody decided, which is exactly
    // what a reviewer needs and what overwriting the components would hide.
    const computed = computeScore(evidence.map(toScoredEvidence), config, now);
    return this.writeSnapshot(
      customerId,
      score,
      { ...computed, reasonCodes: [...computed.reasonCodes, "override"] },
      this.workspace.userId,
      trimmed
    );
  }

  private async writeSnapshot(
    customerId: string,
    score: number,
    computed: ReturnType<typeof computeScore>,
    overrideBy: string | null,
    overrideReason: string | null
  ): Promise<StoredScoreSnapshot> {
    const { data, error } = await this.client.rpc("record_score_snapshot", {
      p_workspace_id: this.workspace.id,
      p_customer_id: customerId,
      p_score: score,
      p_components: computed.components,
      p_disqualifier_penalty: computed.disqualifierPenalty,
      p_confidence: computed.confidence,
      p_top_drivers: computed.topDrivers,
      p_top_blockers: computed.topBlockers,
      p_config_version: computed.configVersion,
      p_evidence_refs: [...computed.evidenceRefs],
      p_reason_codes: [...computed.reasonCodes],
      p_override_by: overrideBy,
      p_override_reason: overrideReason
    });
    if (error) throw new Error("SCORE_SNAPSHOT_WRITE_FAILED");
    const returned = (Array.isArray(data) ? data[0] : data) as
      { snapshot_id: string; previous_score: number | null } | undefined;
    if (!returned) throw new Error("SCORE_SNAPSHOT_WRITE_FAILED");
    return {
      id: String(returned.snapshot_id),
      customerId,
      score,
      components: computed.components,
      disqualifierPenalty: computed.disqualifierPenalty,
      confidence: computed.confidence,
      topDrivers: computed.topDrivers,
      topBlockers: computed.topBlockers,
      configVersion: computed.configVersion,
      evidenceRefs: computed.evidenceRefs,
      reasonCodes: computed.reasonCodes,
      previousScore: returned.previous_score === null ? null : Number(returned.previous_score),
      overrideBy,
      overrideReason,
      calculatedAt: new Date().toISOString()
    };
  }

  /**
   * The state every read of one contact starts from.
   *
   * One row of the same view the index reads, rather than the five queries this
   * used to assemble by hand. The list and the record now answer "what is going
   * on with this contact" from one place: two assemblies of the same state are
   * how a contact ends up Critical on one screen and Normal on the other, and
   * the view was already computing every column this needs.
   */
  private async radarRow(customerId: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.client
      .from("crm_radar_view")
      .select(RADAR_COLUMNS)
      .eq("workspace_id", this.workspace.id)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error) throw new Error("RADAR_READ_FAILED");
    if (!data) throw new Error("CUSTOMER_NOT_FOUND");
    return data as Record<string, unknown>;
  }

  private async stateFor(customerId: string): Promise<NextActionState> {
    return radarState(await this.radarRow(customerId));
  }

  /**
   * One contact as the index sees them, for the record's identity header.
   *
   * The same row and the same ranking, so the header cannot contradict the list
   * an operator arrived from.
   */
  async radarRowFor(customerId: string, now: Date = new Date()): Promise<RadarRow> {
    return toRadarRow(await this.radarRow(customerId), now);
  }

  async attentionFor(customerId: string, now: Date = new Date()): Promise<AttentionVerdict> {
    return rankAttention(await this.stateFor(customerId), now);
  }

  async memoryFor(customerId: string): Promise<readonly StoredFact[]> {
    const { data, error } = await this.client
      .from("contact_facts")
      .select("fact_key,fact_value,confidence,source_ref,recorded_at,valid_until")
      .eq("workspace_id", this.workspace.id)
      .eq("customer_id", customerId)
      .order("recorded_at", { ascending: false });
    if (error) throw new Error("MEMORY_READ_FAILED");
    return (data ?? []).map((row: Record<string, unknown>) => ({
      key: String(row.fact_key),
      value: String(row.fact_value),
      confidence: row.confidence as FactConfidence,
      sourceRef: String(row.source_ref),
      recordedAt: String(row.recorded_at),
      validUntil: (row.valid_until as string | null) ?? null
    }));
  }

  async followUpsFor(customerId: string): Promise<readonly StoredFollowUp[]> {
    const { data, error } = await this.client
      .from("tasks_followups")
      .select(FOLLOWUP_COLUMNS)
      .eq("workspace_id", this.workspace.id)
      .eq("customer_id", customerId)
      .order("due_at", { ascending: true });
    if (error) throw new Error("FOLLOWUP_READ_FAILED");
    return (data ?? []).map(mapFollowUp);
  }

  /**
   * One contact's history, from the rows that recorded it.
   *
   * Ten reads rather than a joined query, because these are ten unrelated
   * tables and a join across them would produce a cartesian mess to
   * de-duplicate in memory anyway. They run together and each is bounded: the
   * read model contract asks the record's secondary detail to be paginated or
   * lazy, and an unbounded timeline is how a three-year-old contact takes the
   * page down.
   */
  async rememberFacts(customerId: string, facts: readonly ProposedFact[]): Promise<number> {
    if (facts.length === 0) return 0;
    const { error } = await this.client.from("contact_facts").upsert(
      facts.map((fact) => ({
        workspace_id: this.workspace.id,
        customer_id: customerId,
        fact_key: fact.key,
        fact_value: fact.value,
        confidence: fact.confidence,
        source_ref: fact.sourceRef,
        recorded_at: fact.recordedAt,
        valid_until: fact.validUntil ?? null,
        updated_at: new Date().toISOString()
      })),
      { onConflict: CONTACT_FACTS_CONFLICT }
    );
    // Counted rather than thrown, the same rule the turn's own fact writer
    // follows: a customer who loses their reply because a fact could not be
    // filed is worse off than one whose fact was not filed.
    return error ? 0 : facts.length;
  }

  /**
   * Applies one model proposal, then recomputes everything that follows from it.
   *
   * Steps 5 to 12 of `10_AI_CRM_WRITE_ENGINE.md`. The classification is pure and
   * lives in `ai-write.ts`; what happens here is the committing, in the order
   * the pack sets: facts and evidence first, then the score, then whether the
   * lifecycle may move, then what to do next.
   *
   * The next action is computed and returned, not stored. A derived action is a
   * function of the state that was just written and goes stale the moment
   * anything moves - the projection refuses `derived` for that reason, and this
   * is the caller that would otherwise have been tempted to write one.
   */
  async applyAiProposal(
    customerId: string,
    proposal: AiCrmProposal,
    now: Date = new Date()
  ): Promise<AiWriteOutcome> {
    // Before anything is read, because this method's return type has no way to
    // say "nothing happened": it promises a classification, a score and a next
    // action. A blocked write has to throw, or the caller reads it as an empty
    // proposal that was considered and produced nothing.
    await assertFeatureEnabled(this.client, this.workspace.id, "ai_proposals");
    const [facts, evidence, definitions, row] = await Promise.all([
      this.memoryFor(customerId),
      this.evidenceFor(customerId),
      this.customFieldDefinitions(),
      this.radarRowFor(customerId, now)
    ]);

    const classified = classifyProposal(
      proposal,
      {
        facts,
        evidenceKeys: new Set(
          evidence
            .filter((item) => item.component && item.evidenceRef)
            .map((item) => evidenceKey(item.component!, item.evidenceRef!))
        ),
        definitions: definitions.map((definition) => ({
          fieldKey: definition.fieldKey,
          fieldType: definition.fieldType,
          aiWrite: definition.aiWrite
        })),
        lifecycleStage: row.lifecycleStage
      },
      now
    );

    const remembered = await this.rememberFacts(
      customerId,
      classified.facts.filter((item) => item.commit).map((item) => item.candidate)
    );

    for (const item of classified.evidence) {
      if (!item.commit) continue;
      await this.recordEvidence({
        customerId,
        signal: item.candidate.signal,
        component: item.candidate.component,
        weight: item.candidate.weight,
        confidence: item.candidate.confidence,
        evidenceRef: item.candidate.evidenceRef
      });
    }

    for (const item of classified.fieldValues) {
      if (!item.commit) continue;
      await this.setCustomFieldValue({
        customerId,
        fieldKey: item.candidate.fieldKey,
        value: item.candidate.value,
        writer: "ai",
        sourceRef: item.candidate.sourceRef,
        ...(item.candidate.authoritative === undefined
          ? {}
          : { authoritative: item.candidate.authoritative })
      });
    }

    // Step 10. Recomputed from the evidence on file rather than adjusted by
    // what was just written: the score is a projection, and a delta applied to
    // it is a second scorer.
    const score = await this.rescoreCustomer(customerId, now);

    // Step 11. The proposal only got as far as "well formed"; whether the move
    // is allowed is the same decision a person's move goes through.
    let transition: TransitionResult | null = null;
    if (classified.transition?.commit) {
      transition = await this.transitionLifecycle({
        customerId,
        // The stage the contact is in, read before anything was written: the
        // transition rules compare against where the move started.
        from: row.lifecycleStage,
        to: classified.transition.candidate.to,
        reasonCodes: classified.transition.candidate.reasonCodes,
        actor: "ai",
        ...(classified.transition.candidate.evidenceRef
          ? { evidenceRef: classified.transition.candidate.evidenceRef }
          : {})
      });
    }

    // Step 12, from the state as it now stands - including the stage this
    // proposal may just have moved.
    const nextAction = proposeNextAction(await this.stateFor(customerId), now);

    // Step 13. What a model changed about a customer is an audited action, not
    // a detail of the turn that produced it.
    await this.client.from("crm_audit_events").insert({
      workspace_id: this.workspace.id,
      actor_user_id: this.workspace.userId,
      customer_id: customerId,
      action: "crm.ai_write",
      metadata: { ...summariseProposal(classified), remembered }
    });

    return { classified, remembered, score, transition, nextAction };
  }

  async timelineFor(
    customerId: string,
    filter: TimelineFilter = {},
    limit = 100
  ): Promise<readonly TimelineEvent[]> {
    const per = Math.min(Math.max(limit, 1), 200);
    const scope = <T>(table: string, columns: string, order: string) =>
      this.client
        .from(table)
        .select(columns)
        .eq("workspace_id", this.workspace.id)
        .eq("customer_id", customerId)
        .order(order, { ascending: false })
        .limit(per) as unknown as Promise<{ data: T[] | null }>;

    const [
      messages,
      notes,
      activities,
      lifecycle,
      scores,
      followUps,
      opportunities,
      handoffs,
      automations,
      audit
    ] = await Promise.all([
      scope<Record<string, unknown>>(
        "messages",
        "id,conversation_id,direction,body,sent_at",
        "sent_at"
      ),
      scope<Record<string, unknown>>("customer_notes", "id,body,created_at", "created_at"),
      scope<Record<string, unknown>>(
        "customer_activities",
        "id,activity_type,summary,occurred_at",
        "occurred_at"
      ),
      scope<Record<string, unknown>>(
        "lifecycle_events",
        "id,from_stage,to_stage,reason_codes,actor,evidence_ref,occurred_at",
        "occurred_at"
      ),
      scope<Record<string, unknown>>(
        "crm_score_snapshots",
        "id,score,previous_score,config_version,override_by,calculated_at",
        "calculated_at"
      ),
      scope<Record<string, unknown>>(
        "tasks_followups",
        "id,objective,due_at,eligibility_state,owner_type,last_result,created_at,updated_at",
        "created_at"
      ),
      scope<Record<string, unknown>>(
        "opportunities",
        "id,stage,value_band,outcome_source,created_at,updated_at",
        "created_at"
      ),
      scope<Record<string, unknown>>("handoff_packets", "id,trigger,raised_at", "raised_at"),
      scope<Record<string, unknown>>(
        "customer_automation_references",
        "id,automation_key,state,created_at",
        "created_at"
      ),
      scope<Record<string, unknown>>("crm_audit_events", "id,action,occurred_at", "occurred_at")
    ]);

    const built = buildTimeline({
      messages: (messages.data ?? []).map((row) => ({
        id: String(row.id),
        conversationId: String(row.conversation_id),
        direction: row.direction as "inbound" | "outbound",
        body: String(row.body ?? ""),
        sentAt: String(row.sent_at)
      })),
      notes: (notes.data ?? []).map((row) => ({
        id: String(row.id),
        body: String(row.body),
        createdAt: String(row.created_at)
      })),
      activities: (activities.data ?? []).map((row) => ({
        id: String(row.id),
        type: String(row.activity_type),
        summary: String(row.summary),
        occurredAt: String(row.occurred_at)
      })),
      lifecycle: (lifecycle.data ?? []).map((row) => ({
        id: String(row.id),
        fromStage: (row.from_stage as string | null) ?? null,
        toStage: String(row.to_stage),
        reasonCodes: (row.reason_codes ?? []) as readonly string[],
        actor: String(row.actor),
        evidenceRef: (row.evidence_ref as string | null) ?? null,
        occurredAt: String(row.occurred_at)
      })),
      scores: (scores.data ?? []).map((row) => ({
        id: String(row.id),
        score: Number(row.score),
        previousScore: row.previous_score === null ? null : Number(row.previous_score),
        configVersion: String(row.config_version),
        overrideBy: (row.override_by as string | null) ?? null,
        calculatedAt: String(row.calculated_at)
      })),
      followUps: (followUps.data ?? []).map((row) => ({
        id: String(row.id),
        objective: String(row.objective),
        dueAt: String(row.due_at),
        eligibilityState: row.eligibility_state as StoredFollowUp["eligibilityState"],
        ownerType: String(row.owner_type),
        lastResult: (row.last_result as string | null) ?? null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at)
      })),
      opportunities: (opportunities.data ?? []).map((row) => ({
        id: String(row.id),
        stage: String(row.stage),
        valueBand: (row.value_band as string | null) ?? null,
        outcomeSource: (row.outcome_source as string | null) ?? null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at)
      })),
      handoffs: (handoffs.data ?? []).map((row) => ({
        id: String(row.id),
        trigger: String(row.trigger),
        raisedAt: String(row.raised_at)
      })),
      automations: (automations.data ?? []).map((row) => ({
        id: String(row.id),
        automationKey: String(row.automation_key),
        state: String(row.state),
        createdAt: String(row.created_at)
      })),
      audit: (audit.data ?? []).map((row) => ({
        id: String(row.id),
        action: String(row.action),
        occurredAt: String(row.occurred_at)
      }))
    });

    return filterTimeline(built, filter).slice(0, per);
  }

  async nowCardFor(customerId: string, now: Date = new Date()): Promise<NowCard> {
    const [state, facts, score, message, conversation] = await Promise.all([
      this.stateFor(customerId),
      this.memoryFor(customerId),
      this.latestScore(customerId),
      // The last meaningful message: one somebody actually sent or received.
      // Automation internals live in the timeline, where they can be filtered;
      // the card has room for one line and it should be the conversation.
      this.client
        .from("messages")
        .select("id,conversation_id,direction,body,sent_at")
        .eq("workspace_id", this.workspace.id)
        .eq("customer_id", customerId)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      this.client
        .from("conversations")
        .select("owner")
        .eq("workspace_id", this.workspace.id)
        .eq("customer_id", customerId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);

    const last = message.data as Record<string, unknown> | null;
    return buildNowCard(
      {
        state,
        facts,
        score: score
          ? {
              id: score.id,
              score: score.score,
              topDrivers: score.topDrivers,
              topBlockers: score.topBlockers,
              evidenceRefs: score.evidenceRefs
            }
          : null,
        lastMessage: last
          ? {
              id: String(last.id),
              conversationId: String(last.conversation_id),
              direction: last.direction as "inbound" | "outbound",
              body: String(last.body ?? ""),
              sentAt: String(last.sent_at)
            }
          : null,
        handling: (conversation.data?.owner as "automation" | "human" | undefined) ?? null
      },
      now
    );
  }

  async radar(query: RadarQuery = {}, now: Date = new Date()): Promise<RadarPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const filter = query.attention ?? null;
    let cursor = query.cursor ? safeCursor(query.cursor) : null;
    const kept: RadarRow[] = [];
    // An attention filter is answered after ranking, so a page can come back
    // short and the read has to continue. The budget is what stops a view that
    // matches almost nothing from walking the whole workspace in one request:
    // it returns fewer rows and a cursor, which is a smaller lie than a long
    // silence.
    const scans = filter ? MAX_RADAR_SCANS : 1;

    for (let scan = 0; scan < scans; scan += 1) {
      const raw = await this.readRadarRows(query, cursor, limit + 1);
      const more = raw.length > limit;
      const batch = raw.slice(0, limit).map((row) => toRadarRow(row, now));
      if (batch.length === 0) return { rows: kept, nextCursor: null };

      for (const [index, row] of batch.entries()) {
        if (filter && !matchesAttention(filter, row)) continue;
        kept.push(row);
        if (kept.length < limit) continue;
        // Full. The cursor is this row rather than the last one scanned, or
        // everything between them is skipped on the next page.
        return {
          rows: kept,
          nextCursor: index + 1 < batch.length || more ? cursorOf(row) : null
        };
      }

      cursor = cursorOf(batch[batch.length - 1]!);
      if (!more) return { rows: kept, nextCursor: null };
    }

    return { rows: kept, nextCursor: cursor };
  }

  private async readRadarRows(
    query: RadarQuery,
    cursor: RadarCursor | null,
    size: number
  ): Promise<Record<string, unknown>[]> {
    let request = this.client
      .from("crm_radar_view")
      .select(RADAR_COLUMNS)
      .eq("workspace_id", this.workspace.id)
      .order("updated_at", { ascending: false })
      .order("customer_id", { ascending: false })
      // One more than asked for, so "is there another page" is answered by the
      // read rather than by a second count query that can disagree with it.
      .limit(size);

    if (query.status) request = request.eq("status", query.status);
    if (query.lifecycleStage) request = request.eq("lifecycle_stage", query.lifecycleStage);
    if (query.leadStatus) request = request.eq("lead_status", query.leadStatus);
    if (query.activeWithinDays) {
      const since = new Date(Date.now() - query.activeWithinDays * 86_400_000);
      request = request.gte("last_activity_at", since.toISOString());
    }
    if (query.query) {
      const safe = query.query.replaceAll(/[,%()]/g, "").slice(0, 80);
      request = request.or(`display_name.ilike.%${safe}%,company_name.ilike.%${safe}%`);
    }
    if (cursor) {
      // Keyset, on the same pair the ordering uses. An offset page shifts under
      // anybody editing a record while somebody else is paging, which silently
      // skips rows rather than failing.
      request = request.or(
        `updated_at.lt.${cursor.updatedAt},` +
          `and(updated_at.eq.${cursor.updatedAt},customer_id.lt.${cursor.customerId})`
      );
    }

    const { data, error } = await request;
    if (error) throw new Error("RADAR_READ_FAILED");
    return (data ?? []) as Record<string, unknown>[];
  }

  async savedViews(): Promise<readonly SavedView[]> {
    const { data, error } = await this.client
      .from("crm_saved_views")
      .select(SAVED_VIEW_COLUMNS)
      .eq("workspace_id", this.workspace.id)
      .order("created_at", { ascending: true });
    if (error) throw new Error("SAVED_VIEW_READ_FAILED");
    return (data ?? []).map(mapSavedView);
  }

  async saveView(raw: SavedViewInput): Promise<SavedView> {
    // A saved view is shared furniture: it changes what the team's index means,
    // which is wider than a viewer's read-only role anywhere else here. The
    // policy on the table says the same thing; this says it before the round
    // trip, and to callers that are not the browser.
    assertWorkspaceOperator(this.workspace);
    const input = savedViewSchema.parse(raw);
    const { data, error } = await this.client
      .from("crm_saved_views")
      .insert({
        workspace_id: this.workspace.id,
        name: input.name,
        status: input.filters.status ?? null,
        lifecycle_stage: input.filters.lifecycleStage ?? null,
        lead_status: input.filters.leadStatus ?? null,
        attention: input.filters.attention ?? null,
        active_within_days: input.filters.activeWithinDays ?? null,
        created_by: this.workspace.userId
      })
      .select(SAVED_VIEW_COLUMNS)
      .single();
    // A name collision is the one failure an operator can fix themselves, so it
    // is named rather than folded into a generic write failure.
    if (error?.code === "23505") throw new Error("SAVED_VIEW_NAME_TAKEN");
    if (error || !data) throw new Error("SAVED_VIEW_WRITE_FAILED");
    return mapSavedView(data);
  }

  async deleteSavedView(viewId: string): Promise<void> {
    assertWorkspaceOperator(this.workspace);
    const { error } = await this.client
      .from("crm_saved_views")
      .delete()
      .eq("workspace_id", this.workspace.id)
      .eq("id", viewId);
    if (error) throw new Error("SAVED_VIEW_DELETE_FAILED");
  }

  async proposeAction(raw: ActionProposalInput): Promise<StoredActionProposal> {
    const input = proposalSchema.parse(raw);
    const { data, error } = await this.client
      .from("crm_next_action_projection")
      .insert({
        workspace_id: this.workspace.id,
        customer_id: input.customerId,
        action_type: input.type,
        reason_codes: [...input.reasonCodes],
        evidence_refs: [...(input.evidenceRefs ?? [])],
        owner_type: input.ownerType,
        owner_id: input.ownerId ?? null,
        due_at: input.dueAt ?? null,
        eligibility: input.eligibility ?? "eligible",
        confidence: input.confidence ?? 1,
        source: input.source
      })
      .select(PROPOSAL_COLUMNS)
      .single();
    if (error || !data) throw new Error("ACTION_PROPOSAL_WRITE_FAILED");
    return mapProposal(data);
  }

  async proposalsFor(customerId: string): Promise<readonly StoredActionProposal[]> {
    const { data, error } = await this.client
      .from("crm_next_action_projection")
      .select(PROPOSAL_COLUMNS)
      .eq("workspace_id", this.workspace.id)
      .eq("customer_id", customerId)
      .is("settled_at", null)
      .order("proposed_at", { ascending: false });
    if (error) throw new Error("ACTION_PROPOSAL_READ_FAILED");
    return (data ?? []).map(mapProposal);
  }

  async settleProposal(
    proposalId: string,
    outcome: "accepted" | "rejected" | "superseded"
  ): Promise<StoredActionProposal> {
    // Taking on or turning down a suggestion is an operational decision, and a
    // viewer's role is to read the queue rather than to answer it.
    assertWorkspaceOperator(this.workspace);
    const { data, error } = await this.client
      .from("crm_next_action_projection")
      .update({ settled_at: new Date().toISOString(), settled_outcome: outcome })
      .eq("workspace_id", this.workspace.id)
      .eq("id", proposalId)
      .select(PROPOSAL_COLUMNS)
      .single();
    if (error || !data) throw new Error("ACTION_PROPOSAL_NOT_FOUND");
    return mapProposal(data);
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

const FIELD_DEFINITION_COLUMNS = "id,name,field_key,field_type,ai_write" as const;

const FIELD_VALUE_COLUMNS =
  "customer_id,definition_id,value,written_by,confidence,source_ref,updated_at" as const;

function mapFieldDefinition(row: Record<string, unknown>): StoredFieldDefinition {
  return {
    id: String(row.id),
    name: String(row.name),
    fieldKey: String(row.field_key),
    fieldType: row.field_type as FieldType,
    aiWrite: row.ai_write as AiWritePermission
  };
}

function mapFieldValue(row: Record<string, unknown>, fieldKey: string): StoredFieldValue {
  return {
    customerId: String(row.customer_id),
    fieldKey,
    value: row.value as string | number | boolean,
    writer: row.written_by as FieldWriter,
    confidence: row.confidence as FieldConfidence,
    sourceRef: String(row.source_ref ?? ""),
    updatedAt: String(row.updated_at)
  };
}

const OPPORTUNITY_COLUMNS =
  "id,customer_id,stage,value_band,owner_id,next_action,lost_reason,outcome_source,outcome_evidence_ref,outcome_recorded_at" as const;

function mapOpportunity(row: Record<string, unknown>): StoredOpportunity {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    stage: row.stage as OpportunityStage,
    valueBand: (row.value_band as StoredOpportunity["valueBand"]) ?? null,
    ownerId: (row.owner_id as string | null) ?? null,
    nextAction: (row.next_action as string | null) ?? null,
    lostReason: (row.lost_reason as string | null) ?? null,
    outcomeSource: (row.outcome_source as OutcomeSource | null) ?? null,
    outcomeEvidenceRef: (row.outcome_evidence_ref as string | null) ?? null,
    outcomeRecordedAt: (row.outcome_recorded_at as string | null) ?? null
  };
}

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

/** Only the fields the scorer reads. Signal and id are the workspace's, not its. */
function toScoredEvidence(evidence: StoredEvidence): ScoredEvidence {
  return {
    component: evidence.component,
    weight: evidence.weight,
    confidence: evidence.confidence,
    evidenceRef: evidence.evidenceRef,
    expiresAt: evidence.expiresAt
  };
}

const RADAR_COLUMNS =
  "customer_id,display_name,company_name,status,source,lifecycle_stage,lead_status,created_at,updated_at,score,unread_inbound,human_review_requested,followup_due_at,followup_snoozed_until,opted_out,has_evidence,owner_id,channel,last_activity_at,current_need,current_need_confidence" as const;

const SAVED_VIEW_COLUMNS =
  "id,name,status,lifecycle_stage,lead_status,attention,active_within_days,created_at" as const;

/**
 * How many pages an attention-filtered read will walk before giving up.
 *
 * Only the filters no column can answer need this, and the alternative to a
 * budget is a request whose cost is set by how empty the view happens to be.
 */
const MAX_RADAR_SCANS = 5;

/**
 * The two halves of a cursor, checked rather than trusted.
 *
 * A cursor comes back through a URL and both halves are interpolated into a
 * PostgREST filter expression, where a comma or a parenthesis is syntax rather
 * than data. These are shapes with exactly one form each, so the check is what
 * they may contain - escaping would be answering a harder question than the one
 * asked.
 */
const CURSOR_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?$/;
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeCursor(cursor: RadarCursor): RadarCursor {
  if (!CURSOR_TIMESTAMP.test(cursor.updatedAt) || !CURSOR_ID.test(cursor.customerId)) {
    throw new Error("INVALID_RADAR_CURSOR");
  }
  return cursor;
}

const cursorOf = (row: RadarRow): RadarCursor => ({
  updatedAt: row.updatedAt,
  customerId: row.customerId
});

function mapSavedView(row: Record<string, unknown>): SavedView {
  return {
    id: String(row.id),
    name: String(row.name),
    filters: {
      ...(row.status ? { status: row.status as "active" | "archived" } : {}),
      ...(row.lifecycle_stage ? { lifecycleStage: row.lifecycle_stage as LifecycleStage } : {}),
      ...(row.lead_status ? { leadStatus: row.lead_status as LeadStatus } : {}),
      ...(row.attention ? { attention: row.attention as (typeof ATTENTION_FILTERS)[number] } : {}),
      ...(row.active_within_days ? { activeWithinDays: Number(row.active_within_days) } : {})
    },
    createdAt: String(row.created_at)
  };
}

const PROPOSAL_COLUMNS =
  "id,customer_id,action_type,reason_codes,evidence_refs,owner_type,owner_id,due_at,eligibility,confidence,source,settled_at,settled_outcome,proposed_at" as const;

/**
 * Turns one view row into a radar row, ranking it on the way.
 *
 * The view supplies inputs and this applies the rules, which is why the same
 * ranking serves the list and the record screen. Two implementations - one in
 * SQL for the list, one in TypeScript for the detail - is how a contact ends up
 * Critical on one screen and Normal on the other.
 */
/**
 * The state the rules read, from one view row.
 *
 * Shared by the list and the record so there is one derivation of it. The
 * columns are the view's; everything above them - priority, next action, the
 * Now card - is computed from this and nowhere else.
 */
function radarState(row: Record<string, unknown>): NextActionState {
  return {
    leadStatus: row.lead_status as LeadStatus,
    lifecycleStage: row.lifecycle_stage as LifecycleStage,
    unreadInbound: Number(row.unread_inbound ?? 0),
    humanReviewRequested: row.human_review_requested === true,
    followUpDueAt: (row.followup_due_at as string | null) ?? null,
    followUpSnoozedUntil: (row.followup_snoozed_until as string | null) ?? null,
    optedOut: row.opted_out === true,
    qualificationScore: row.score === null ? null : Number(row.score),
    ownerId: (row.owner_id as string | null) ?? null,
    hasEvidence: row.has_evidence === true
  };
}

function toRadarRow(row: Record<string, unknown>, now: Date): RadarRow {
  const state = radarState(row);
  const attention = rankAttention(state, now);
  return {
    customerId: String(row.customer_id),
    displayName: String(row.display_name),
    companyName: row.company_name ? String(row.company_name) : null,
    status: row.status as "active" | "archived",
    source: String(row.source),
    lifecycleStage: state.lifecycleStage,
    leadStatus: state.leadStatus,
    score: state.qualificationScore ?? null,
    priority: attention.priority,
    reasons: attention.reasons,
    nextAction: proposeNextAction(state, now),
    ownerId: state.ownerId ?? null,
    channel: row.channel ? String(row.channel) : null,
    lastActivityAt: String(row.last_activity_at),
    updatedAt: String(row.updated_at),
    currentNeed: row.current_need ? String(row.current_need) : null,
    currentNeedConfidence: row.current_need_confidence
      ? (row.current_need_confidence as FactConfidence)
      : null
  };
}

function mapProposal(row: Record<string, unknown>): StoredActionProposal {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    type: row.action_type as NextActionType,
    reasonCodes: (row.reason_codes ?? []) as readonly string[],
    evidenceRefs: (row.evidence_refs ?? []) as readonly string[],
    ownerType: row.owner_type as ActionOwner,
    ownerId: (row.owner_id as string | null) ?? null,
    dueAt: (row.due_at as string | null) ?? null,
    eligibility: row.eligibility as ActionEligibility,
    confidence: Number(row.confidence),
    source: row.source as ActionSource,
    settledAt: (row.settled_at as string | null) ?? null,
    settledOutcome: (row.settled_outcome as StoredActionProposal["settledOutcome"]) ?? null,
    proposedAt: String(row.proposed_at)
  };
}

const EVIDENCE_COLUMNS =
  "id,customer_id,signal,component,weight,confidence,evidence_ref,recorded_at,expires_at" as const;

function mapEvidence(row: Record<string, unknown>): StoredEvidence {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    signal: String(row.signal),
    component: row.component as EvidenceComponent,
    weight: Number(row.weight),
    confidence: row.confidence as StoredEvidence["confidence"],
    evidenceRef: String(row.evidence_ref),
    recordedAt: String(row.recorded_at),
    expiresAt: (row.expires_at as string | null) ?? null
  };
}

const SCORE_CONFIG_COLUMNS = "id,version,components,disqualifier_min,created_at" as const;

const SNAPSHOT_COLUMNS =
  "id,customer_id,score,components,disqualifier_penalty,confidence,top_drivers,top_blockers,config_version,evidence_refs,reason_codes,previous_score,override_by,override_reason,calculated_at" as const;

function mapScoreConfig(row: Record<string, unknown>): StoredScoreConfig {
  return {
    id: String(row.id),
    version: String(row.version),
    components: row.components as ScoreConfig["components"],
    disqualifierMin: Number(row.disqualifier_min),
    createdAt: String(row.created_at)
  };
}

function mapSnapshot(row: Record<string, unknown>): StoredScoreSnapshot {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    score: Number(row.score),
    components: row.components as ScoreConfig["components"],
    disqualifierPenalty: Number(row.disqualifier_penalty),
    confidence: Number(row.confidence),
    topDrivers: (row.top_drivers ?? []) as readonly ScoreDriver[],
    topBlockers: (row.top_blockers ?? []) as readonly ScoreBlocker[],
    configVersion: String(row.config_version),
    evidenceRefs: (row.evidence_refs ?? []) as readonly string[],
    reasonCodes: (row.reason_codes ?? []) as readonly string[],
    previousScore: row.previous_score === null ? null : Number(row.previous_score),
    overrideBy: (row.override_by as string | null) ?? null,
    overrideReason: (row.override_reason as string | null) ?? null,
    calculatedAt: String(row.calculated_at)
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
