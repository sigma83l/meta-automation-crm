import { appError, err, ok, type Result } from "@/src/lib/result";
export const runStates = [
  "NEW",
  "WELCOME_SENT",
  "COLLECTING_FIELDS",
  "WAITING_FOR_MEDIA",
  "QUALIFIED",
  "COMPLETED",
  "HUMAN_REVIEW",
  "OPTED_OUT",
  "WINDOW_CLOSED",
  "FAILED"
] as const;
export type RunState = (typeof runStates)[number];
const terminal = new Set<RunState>(["COMPLETED", "OPTED_OUT", "WINDOW_CLOSED", "FAILED"]);
const allowed: Record<RunState, readonly RunState[]> = {
  NEW: ["WELCOME_SENT"],
  WELCOME_SENT: ["COLLECTING_FIELDS"],
  COLLECTING_FIELDS: ["WAITING_FOR_MEDIA", "QUALIFIED"],
  WAITING_FOR_MEDIA: ["QUALIFIED"],
  QUALIFIED: ["COMPLETED"],
  COMPLETED: [],
  HUMAN_REVIEW: ["COLLECTING_FIELDS", "WAITING_FOR_MEDIA", "QUALIFIED"],
  OPTED_OUT: [],
  WINDOW_CLOSED: [],
  FAILED: []
};
const interrupts: RunState[] = ["HUMAN_REVIEW", "OPTED_OUT", "WINDOW_CLOSED", "FAILED"];
export function transitionRun(current: RunState, next: RunState): Result<RunState> {
  if (terminal.has(current) || (!allowed[current].includes(next) && !interrupts.includes(next)))
    return err(appError("VALIDATION_ERROR", `Invalid automation transition ${current} → ${next}.`));
  return ok(next);
}
export type SendPolicy = Readonly<{
  workspaceActive: boolean;
  automationActive: boolean;
  immutableVersion: boolean;
  connectionHealthy: boolean;
  customerWorkspaceMatches: boolean;
  idempotencyUnused: boolean;
  optedOut: boolean;
  consentValid: boolean;
  windowOpen: boolean;
  channel: "instagram" | "whatsapp";
  kind: "private_reply" | "free_form" | "template";
  instagramPrivateReplyUsed: boolean;
  trustedUserInitiated: boolean;
  templateApproved: boolean;
  whatsappOptIn: boolean;
  quietHours: boolean;
  frequencyAllowed: boolean;
  aiConfidence: number;
  minimumAiConfidence: number;
  humanTakeover: boolean;
  recipientAllowlisted: boolean;
  nonProduction: boolean;
}>;
export function authorizeAutomationSend(p: SendPolicy): Result<"AUTHORIZED"> {
  const blocked =
    !p.workspaceActive ||
    !p.automationActive ||
    !p.immutableVersion ||
    !p.connectionHealthy ||
    !p.customerWorkspaceMatches ||
    !p.idempotencyUnused ||
    p.optedOut ||
    !p.consentValid ||
    p.quietHours ||
    !p.frequencyAllowed ||
    p.aiConfidence < p.minimumAiConfidence ||
    p.humanTakeover ||
    (p.nonProduction && !p.recipientAllowlisted);
  if (blocked) return err(appError("LIVE_SEND_BLOCKED", "Automation send policy denied."));
  if (p.channel === "instagram") {
    if (p.kind === "private_reply") {
      if (p.instagramPrivateReplyUsed)
        return err(appError("LIVE_SEND_BLOCKED", "Instagram private reply already used."));
    } else if (!p.trustedUserInitiated || !p.windowOpen)
      return err(appError("LIVE_SEND_BLOCKED", "Instagram cold or closed-window DM denied."));
  }
  if (
    p.channel === "whatsapp" &&
    !p.windowOpen &&
    !(p.kind === "template" && p.templateApproved && p.whatsappOptIn)
  )
    return err(
      appError(
        "LIVE_SEND_BLOCKED",
        "WhatsApp service window requires an approved opted-in template."
      )
    );
  return ok("AUTHORIZED");
}
export type Recipe = "INSTAGRAM_COMMENT_TO_DM" | "INSTAGRAM_INBOUND_DM" | "WHATSAPP_INBOUND";
export type RecipeEvent = Readonly<{
  id: string;
  channel: "instagram" | "whatsapp";
  kind: "comment" | "message" | "image" | "opt_out" | "human_takeover" | "resume";
  trusted: boolean;
  text?: string;
  fieldValues?: Readonly<Record<string, string>>;
  now: string;
}>;
export type RecipeRun = Readonly<{
  recipe: Recipe;
  state: RunState;
  welcomed: boolean;
  privateReplySent: boolean;
  userResponded: boolean;
  windowExpiresAt?: string;
  fields: Readonly<Record<string, string>>;
  requiredFields: readonly string[];
  mediaCount: number;
  humanPaused: boolean;
  processedEventIds: readonly string[];
  timeline: readonly string[];
}>;
export function newRecipeRun(recipe: Recipe, requiredFields: readonly string[]): RecipeRun {
  return {
    recipe,
    state: "NEW",
    welcomed: false,
    privateReplySent: false,
    userResponded: false,
    fields: {},
    requiredFields,
    mediaCount: 0,
    humanPaused: false,
    processedEventIds: [],
    timeline: []
  };
}
export function processRecipeEvent(run: RecipeRun, event: RecipeEvent): RecipeRun {
  if (run.processedEventIds.includes(event.id)) return run;
  const processedEventIds = [...run.processedEventIds, event.id],
    timeline = [...run.timeline, `event:${event.kind}`];
  if (event.kind === "opt_out")
    return {
      ...run,
      state: "OPTED_OUT",
      processedEventIds,
      timeline: [...timeline, "automation:opted_out"]
    };
  if (event.kind === "human_takeover")
    return {
      ...run,
      state: "HUMAN_REVIEW",
      humanPaused: true,
      processedEventIds,
      timeline: [...timeline, "automation:human_takeover"]
    };
  if (event.kind === "resume")
    return {
      ...run,
      state: run.mediaCount ? "WAITING_FOR_MEDIA" : "COLLECTING_FIELDS",
      humanPaused: false,
      processedEventIds,
      timeline: [...timeline, "automation:resumed"]
    };
  if (run.humanPaused) return { ...run, processedEventIds, timeline };
  if (run.recipe === "INSTAGRAM_COMMENT_TO_DM" && event.kind === "comment")
    return {
      ...run,
      state: "WELCOME_SENT",
      privateReplySent: true,
      processedEventIds,
      timeline: [...timeline, "send:private_reply_once"]
    };
  if (run.recipe === "INSTAGRAM_COMMENT_TO_DM" && !run.userResponded && event.kind !== "message")
    return { ...run, processedEventIds, timeline };
  const trustedMessage = event.trusted && (event.kind === "message" || event.kind === "image");
  const windowExpiresAt = trustedMessage
    ? new Date(new Date(event.now).getTime() + 24 * 60 * 60 * 1000).toISOString()
    : run.windowExpiresAt;
  const fields = { ...run.fields, ...event.fieldValues };
  const mediaCount = run.mediaCount + (event.kind === "image" ? 1 : 0);
  const missing = run.requiredFields.filter((field) => !fields[field]);
  const state: RunState = missing.length
    ? "COLLECTING_FIELDS"
    : mediaCount === 0
      ? "WAITING_FOR_MEDIA"
      : "QUALIFIED";
  return {
    ...run,
    state,
    welcomed: true,
    userResponded: run.userResponded || event.kind === "message",
    ...(windowExpiresAt ? { windowExpiresAt } : {}),
    fields,
    mediaCount,
    processedEventIds,
    timeline: [
      ...timeline,
      event.kind === "image"
        ? "media:acknowledged"
        : missing.length
          ? `ask:${missing[0]}`
          : "crm:saved"
    ]
  };
}
export function remainingWindowSeconds(expiresAt: string | undefined, now: string) {
  return expiresAt
    ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - new Date(now).getTime()) / 1000))
    : 0;
}
