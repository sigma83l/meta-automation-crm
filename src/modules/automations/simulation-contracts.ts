import { z } from "zod";

import type { TurnRecord } from "@/src/modules/rcos/turn-engine";

/**
 * The wire shape of a Test Center run.
 *
 * Separate from `server/simulation.ts` because the console renders this and the
 * console is a client component: importing the runner for its types would drag
 * `server-only` — and the Supabase admin client behind it — into the browser
 * bundle's module graph.
 */

export const SIMULATION_CHANNELS = ["whatsapp", "instagram"] as const;

/**
 * How the conversation behind the turn is supplied.
 *
 * `conversation` is the higher-fidelity answer and should be preferred whenever
 * the workspace has traffic: every gate is evaluated by the real port against a
 * real row. `synthetic` exists because a workspace that has not launched yet
 * has nothing to point at, and "you cannot test until you have customers" is
 * the wrong answer for a pre-activation check.
 */
export const SIMULATION_SUBJECTS = ["conversation", "synthetic"] as const;

export type SimulationSubjectKind = (typeof SIMULATION_SUBJECTS)[number];

export const simulationRequestSchema = z
  .object({
    automationId: z.uuid(),
    channel: z.enum(SIMULATION_CHANNELS),
    message: z.string().trim().min(1).max(4000),
    /** Present for `conversation` mode; absent means `synthetic`. */
    conversationId: z.uuid().optional()
  })
  .strict();

export type SimulationRequest = z.infer<typeof simulationRequestSchema>;

/**
 * The twelve steps, in the order `runTurn` performs them.
 *
 * Held as data so the console renders the whole pipeline even when a turn stops
 * early: a step that never ran is itself the finding, and a list that only
 * showed what executed would hide where it stopped.
 */
export const SIMULATION_STEPS = [
  { step: 1, id: "idempotency", label: "Idempotency" },
  { step: 2, id: "hydrate", label: "Hydrate conversation" },
  { step: 3, id: "memory", label: "Load memory" },
  { step: 4, id: "policy", label: "Consent, window and policy" },
  { step: 5, id: "understand", label: "Understand" },
  { step: 6, id: "retrieve", label: "Retrieve approved knowledge" },
  { step: 7, id: "decide", label: "Decide" },
  { step: 8, id: "tool", label: "Tool safety" },
  { step: 9, id: "compose", label: "Compose" },
  { step: 10, id: "validate", label: "Validate reply" },
  { step: 11, id: "commit", label: "Commit, then send" },
  { step: 12, id: "observe", label: "Observe" }
] as const;

export type SimulationStepId = (typeof SIMULATION_STEPS)[number]["id"];

export type SimulationStepStatus = "ran" | "skipped" | "blocked" | "stipulated";

export type SimulationStep = Readonly<{
  step: number;
  id: SimulationStepId;
  label: string;
  /** `skipped` means the engine never reached this port, which is a result. */
  status: SimulationStepStatus;
  detail: string;
}>;

export type SimulationVerdict = "would_send" | "would_block" | "would_hand_off";

/**
 * One model call the turn made, flattened for the wire.
 *
 * Without these, every way a draft can come back empty reports as
 * `empty_draft`: no budget, no credential, a provider that refused, a provider
 * that timed out, and a model that answered and asked for a person all produce
 * the same empty string and the same reason code. They have five different
 * owners and five different fixes, and the engine already records which one
 * happened — it was simply never shown.
 */
export type SimulationModelCall = Readonly<{
  role: string;
  model: string;
  outcome: "ok" | "failed" | "skipped";
  failureCode?: string;
  failureKind?: string;
  /** True only when the model itself asked for a person. */
  deferredToHuman?: boolean;
}>;

export type SimulationTrace = Readonly<{
  verdict: SimulationVerdict;
  outcome: TurnRecord["outcome"];
  reasonCodes: readonly string[];
  subject: SimulationSubjectKind;
  channel: (typeof SIMULATION_CHANNELS)[number];
  automation: Readonly<{ id: string; name: string; recipe: string; status: string }>;
  steps: readonly SimulationStep[];
  /** The reply the engine composed, shown whether or not it passed validation. */
  draft?: Readonly<{ text: string; citedRefs: readonly string[] }>;
  /** What `send` would have been called with. Absent means nothing goes out. */
  wouldSend?: Readonly<{ text: string; sendRef: string }>;
  /** Every model call this turn made, in order. Empty when none was attempted. */
  modelCalls: readonly SimulationModelCall[];
  memory: Readonly<{ accepted: number; refused: number }>;
}>;
