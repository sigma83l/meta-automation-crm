import "server-only";

import { randomUUID } from "node:crypto";

import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { authorizeWorkspaceEntitlement } from "@/src/modules/billing/entitlement";
import type { SubscriptionStatus } from "@/src/modules/billing/contracts";
import { isFeatureEnabled, isPlatformSwitchEnabled } from "@/src/modules/features/server/gate";
import { runTurn, type TurnEvent, type TurnPolicy } from "@/src/modules/rcos/turn-engine";
import { createTurnRuntime } from "@/src/modules/rcos/turn-runtime";
import { instrumentPorts, verdictFor } from "@/src/modules/automations/server/simulation-trace";
import type {
  SimulationModelCall,
  SimulationRequest,
  SimulationSubjectKind,
  SimulationTrace
} from "@/src/modules/automations/simulation-contracts";
import {
  assertWorkspaceOperator,
  type TrustedWorkspace
} from "@/src/modules/workspaces/server/resolve-workspace";

/**
 * A dry run of the turn engine, for an operator deciding whether an automation
 * is safe to activate.
 *
 * The whole value of this is that it is the *same* engine. `runTurn` is called
 * unmodified, with the workspace's real ports, so the ordering that makes the
 * pipeline safe — dedupe before work, policy before any model, validation
 * before sending, commit before send — is the ordering being demonstrated. A
 * second implementation that "simulates" the pipeline would answer a question
 * nobody asked.
 *
 * Two things are deliberately not real:
 *
 * 1. **Nothing is written.** `commit`, `send`, `persistFacts` and `observe` are
 *    replaced by recorders in `instrumentPorts`. A simulation that left rows
 *    behind would put synthetic messages in a real inbox and synthetic turns in
 *    the audit trail, and an operator could no longer tell a test from a
 *    customer.
 * 2. **In `synthetic` mode the conversation is stipulated.** See
 *    `stipulatedPolicy`.
 *
 * Everything else — entitlement, feature flags, the platform switch, the
 * workspace's knowledge, its policy, its models — is read live.
 */

/** Raised when the workspace cannot be simulated at all, rather than blocked. */
export class SimulationUnavailableError extends Error {
  constructor(readonly code: "NO_BUSINESS_PROFILE" | "AUTOMATION_NOT_FOUND") {
    super(code);
    this.name = "SimulationUnavailableError";
  }
}

/**
 * Policy for a conversation that does not exist.
 *
 * Only the conversation row is invented — an open conversation nobody has taken
 * over, which is the state an automation would actually fire in. Entitlement,
 * the platform switch and the workspace's feature flag are evaluated by the
 * same functions the real port calls, in the same order, so a workspace whose
 * billing has lapsed or whose AI replies are switched off still blocks here and
 * says so. Duplicating those checks instead would let the simulator and the
 * engine drift, and the first symptom would be a green test for a turn that
 * production refuses.
 *
 * The alternative — refusing to simulate until the workspace has real traffic —
 * would make the pre-activation check useless to exactly the operator who needs
 * it most, the one who has not launched yet.
 */
async function stipulatedPolicy(
  admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
  workspaceId: string
): Promise<TurnPolicy> {
  const allowedActions: readonly string[] = [];
  const blocked = (blockedReason: string): TurnPolicy => ({
    canSend: false,
    allowedActions,
    blockedReason
  });

  const { data, error } = await admin
    .from("workspace_subscriptions")
    .select("status,trial_ends_at,current_period_ends_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error("TURN_POLICY_READ_FAILED");

  const entitlement = data
    ? authorizeWorkspaceEntitlement({
        status: data.status as SubscriptionStatus,
        trialEndsAt: data.trial_ends_at as string | null,
        currentPeriodEndsAt: data.current_period_ends_at as string | null
      })
    : null;
  if (!entitlement || !entitlement.ok) return blocked("billing_entitlement_required");
  if (!(await isPlatformSwitchEnabled(admin, "ai_replies"))) return blocked("ai_replies_paused");
  if (!(await isFeatureEnabled(admin, workspaceId, "ai_replies"))) {
    return blocked("ai_replies_disabled");
  }
  return { canSend: true, allowedActions };
}

export async function simulateAutomationTurn(
  workspace: TrustedWorkspace,
  request: SimulationRequest
): Promise<SimulationTrace> {
  assertWorkspaceOperator(workspace);
  const admin = await createSupabaseAdminClient();

  const automation = await admin
    .from("automations")
    .select("id,name,recipe,status")
    .eq("workspace_id", workspace.id)
    .eq("id", request.automationId)
    .maybeSingle();
  if (automation.error) throw new Error("AUTOMATION_LOOKUP_FAILED");
  if (!automation.data) throw new SimulationUnavailableError("AUTOMATION_NOT_FOUND");

  const subject: SimulationSubjectKind = request.conversationId ? "conversation" : "synthetic";
  const event: TurnEvent = {
    eventId: randomUUID(),
    workspaceId: workspace.id,
    // A synthetic run still needs an id for the engine's own bookkeeping. It
    // matches no row, which is exactly why `stipulatedPolicy` replaces step 4.
    conversationId: request.conversationId ?? randomUUID(),
    channel: request.channel,
    text: request.message,
    occurredAt: new Date().toISOString()
  };

  // Collected through the runtime's own seam rather than inferred from the
  // outcome. Five different causes produce an empty draft and the same
  // `empty_draft` code; this is the only place that says which one it was.
  const modelCalls: SimulationModelCall[] = [];

  const runtime = await createTurnRuntime(
    admin,
    event,
    {
      customerId: randomUUID(),
      recipientRef: "test-center-synthetic",
      // Never `live`. The send port is replaced regardless, but a sandbox
      // subject means nothing downstream can read this as a real recipient
      // either.
      connectionMode: "sandbox"
    },
    {
      onCall: (record) =>
        void modelCalls.push({
          role: String(record.role),
          model: record.model,
          outcome: record.outcome,
          ...(record.failureCode ? { failureCode: record.failureCode } : {}),
          ...(record.failureKind ? { failureKind: record.failureKind } : {}),
          ...(record.deferredToHuman === undefined
            ? {}
            : { deferredToHuman: record.deferredToHuman }),
          ...(record.deferralReason ? { deferralReason: record.deferralReason } : {})
        })
    }
  );
  if (!runtime) throw new SimulationUnavailableError("NO_BUSINESS_PROFILE");

  const instrumented = instrumentPorts(runtime.ports, {
    subject,
    ...(subject === "synthetic" ? { policy: () => stipulatedPolicy(admin, workspace.id) } : {})
  });

  const record = await runTurn(event, instrumented.ports);
  const draft = instrumented.draft();
  const wouldSend = instrumented.wouldSend();
  const validationDetail = instrumented.validationDetail(record.reasonCodes);

  return {
    verdict: verdictFor(record.outcome),
    outcome: record.outcome,
    reasonCodes: record.reasonCodes,
    subject,
    channel: request.channel,
    automation: {
      id: String(automation.data.id),
      name: String(automation.data.name),
      recipe: String(automation.data.recipe),
      status: String(automation.data.status)
    },
    steps: instrumented.steps(),
    ...(draft ? { draft } : {}),
    ...(wouldSend ? { wouldSend } : {}),
    modelCalls,
    ...(validationDetail && validationDetail.length > 0 ? { validationDetail } : {}),
    memory: { accepted: record.acceptedMemoryWrites, refused: record.refusedMemoryWrites }
  };
}
