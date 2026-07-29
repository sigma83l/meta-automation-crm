import { describe, expect, it } from "vitest";
import {
  authorizeAutomationSend,
  newRecipeRun,
  processRecipeEvent,
  remainingWindowSeconds,
  transitionRun,
  type SendPolicy
} from "@/src/modules/automations/engine";
import {
  SendIdempotencyLedger,
  failDurableStep,
  recoverDeadLetter
} from "@/src/modules/automations/durable";
const basePolicy: SendPolicy = {
  workspaceActive: true,
  automationActive: true,
  immutableVersion: true,
  connectionHealthy: true,
  customerWorkspaceMatches: true,
  idempotencyUnused: true,
  optedOut: false,
  consentValid: true,
  windowOpen: true,
  channel: "instagram",
  kind: "free_form",
  instagramPrivateReplyUsed: false,
  trustedUserInitiated: true,
  templateApproved: false,
  whatsappOptIn: false,
  quietHours: false,
  frequencyAllowed: true,
  aiConfidence: 0.9,
  minimumAiConfidence: 0.65,
  humanTakeover: false,
  recipientAllowlisted: true,
  nonProduction: true
};
const event = (
  id: string,
  kind:
    | "comment"
    | "message"
    | "image"
    | "opt_out"
    | "human_takeover"
    | "resume"
    | "schedule_due"
    | "after_hours"
    | "low_confidence",
  channel: "instagram" | "whatsapp" = "instagram",
  extra = {}
) => ({ id, kind, channel, trusted: true, now: "2026-01-01T00:00:00.000Z", ...extra });
describe("durable automation recipes", () => {
  it("runs Instagram comment-to-DM only after one private reply and user DM", () => {
    let run = newRecipeRun("INSTAGRAM_COMMENT_TO_DM", ["name"]);
    run = processRecipeEvent(run, event("comment-1", "comment"));
    expect(run.privateReplySent).toBe(true);
    expect(run.state).toBe("WELCOME_SENT");
    const duplicate = processRecipeEvent(run, event("comment-1", "comment"));
    expect(duplicate.timeline).toEqual(run.timeline);
    const imageBeforeDm = processRecipeEvent(run, event("image-early", "image"));
    expect(imageBeforeDm.state).toBe("WELCOME_SENT");
    run = processRecipeEvent(
      run,
      event("dm-1", "message", "instagram", { fieldValues: { name: "Synthetic Ada" } })
    );
    expect(run.userResponded).toBe(true);
    expect(run.state).toBe("WAITING_FOR_MEDIA");
    run = processRecipeEvent(run, event("image-1", "image"));
    expect(run.state).toBe("QUALIFIED");
    expect(run.timeline).toContain("media:acknowledged");
  });
  it("runs Instagram inbound DM one field at a time and saves CRM timeline", () => {
    let run = newRecipeRun("INSTAGRAM_INBOUND_DM", ["name", "email"]);
    run = processRecipeEvent(
      run,
      event("dm-1", "message", "instagram", { fieldValues: { name: "Ada" } })
    );
    expect(run.timeline.at(-1)).toBe("ask:email");
    run = processRecipeEvent(
      run,
      event("dm-2", "message", "instagram", { fieldValues: { email: "ada@example.test" } })
    );
    expect(run.state).toBe("WAITING_FOR_MEDIA");
    run = processRecipeEvent(run, event("img-1", "image"));
    expect(run.state).toBe("QUALIFIED");
    expect(run.timeline).toContain("crm:saved");
  });
  it("runs WhatsApp inbound and opens a 24-hour trusted window", () => {
    let run = newRecipeRun("WHATSAPP_INBOUND", ["phone"]);
    run = processRecipeEvent(
      run,
      event("wa-1", "message", "whatsapp", { fieldValues: { phone: "+10000000000" } })
    );
    expect(remainingWindowSeconds(run.windowExpiresAt, "2026-01-01T00:00:00.000Z")).toBe(86400);
    run = processRecipeEvent(run, event("wa-img", "image", "whatsapp"));
    expect(run.state).toBe("QUALIFIED");
  });
  it("enforces Instagram private reply, no cold DM, and closed window", () => {
    expect(authorizeAutomationSend({ ...basePolicy, kind: "private_reply" }).ok).toBe(true);
    expect(
      authorizeAutomationSend({
        ...basePolicy,
        kind: "private_reply",
        instagramPrivateReplyUsed: true
      }).ok
    ).toBe(false);
    expect(authorizeAutomationSend({ ...basePolicy, trustedUserInitiated: false }).ok).toBe(false);
    expect(authorizeAutomationSend({ ...basePolicy, windowOpen: false }).ok).toBe(false);
  });
  it("allows WhatsApp free form inside window and only opted-in approved templates outside", () => {
    const whatsapp = { ...basePolicy, channel: "whatsapp" as const };
    expect(authorizeAutomationSend(whatsapp).ok).toBe(true);
    expect(authorizeAutomationSend({ ...whatsapp, windowOpen: false }).ok).toBe(false);
    expect(
      authorizeAutomationSend({
        ...whatsapp,
        windowOpen: false,
        kind: "template",
        templateApproved: true,
        whatsappOptIn: true
      }).ok
    ).toBe(true);
  });
  it.each([
    { optedOut: true },
    { humanTakeover: true },
    { automationActive: false },
    { workspaceActive: false },
    { connectionHealthy: false },
    { frequencyAllowed: false },
    { quietHours: true },
    { aiConfidence: 0.2 },
    { idempotencyUnused: false }
  ])("blocks immediate policy violation %o", (override) => {
    expect(authorizeAutomationSend({ ...basePolicy, ...override }).ok).toBe(false);
  });
  it("pauses for human takeover, requires resume, and honors opt-out during wait", () => {
    let run = processRecipeEvent(
      newRecipeRun("INSTAGRAM_INBOUND_DM", ["name"]),
      event("dm", "message")
    );
    run = processRecipeEvent(run, event("takeover", "human_takeover"));
    expect(run.state).toBe("HUMAN_REVIEW");
    const paused = processRecipeEvent(
      run,
      event("ignored", "message", "instagram", { fieldValues: { name: "Must not collect" } })
    );
    expect(paused.fields.name).toBeUndefined();
    run = processRecipeEvent(paused, event("resume", "resume"));
    expect(run.humanPaused).toBe(false);
    run = processRecipeEvent(run, event("opt", "opt_out"));
    expect(run.state).toBe("OPTED_OUT");
  });
  it("sends one consented approved WhatsApp reminder and deduplicates it", () => {
    const run = newRecipeRun("WHATSAPP_CONSENTED_FOLLOWUP_REMINDER", []);
    const due = event("reminder-due-1", "schedule_due", "whatsapp", {
      consentValid: true,
      whatsappOptIn: true,
      templateApproved: true
    });
    const completed = processRecipeEvent(run, due);
    expect(completed.state).toBe("COMPLETED");
    expect(completed.remindersSent).toBe(1);
    expect(completed.timeline).toContain("send:approved_template_reminder");
    expect(processRecipeEvent(completed, due)).toBe(completed);
  });
  it("fails closed when reminder consent or template authority is absent", () => {
    const blocked = processRecipeEvent(
      newRecipeRun("WHATSAPP_CONSENTED_FOLLOWUP_REMINDER", []),
      event("reminder-due-2", "schedule_due", "whatsapp", {
        consentValid: true,
        whatsappOptIn: false,
        templateApproved: true
      })
    );
    expect(blocked.state).toBe("HUMAN_REVIEW");
    expect(blocked.humanPaused).toBe(true);
    expect(blocked.timeline).toContain("reminder:blocked");
  });
  it("escalates after hours and low confidence without cross-channel sending", () => {
    for (const kind of ["after_hours", "low_confidence"] as const) {
      const escalated = processRecipeEvent(
        newRecipeRun("CROSS_CHANNEL_AFTER_HOURS_ESCALATION", []),
        event(`escalation-${kind}`, kind)
      );
      expect(escalated.state).toBe("HUMAN_REVIEW");
      expect(escalated.escalationReason).toBe(kind);
      expect(escalated.timeline).toContain("send:none");
    }
  });
  it("rejects invented transitions", () => {
    expect(transitionRun("NEW", "COMPLETED").ok).toBe(false);
    expect(transitionRun("NEW", "WELCOME_SENT").ok).toBe(true);
    expect(transitionRun("COMPLETED", "HUMAN_REVIEW").ok).toBe(false);
  });
  it("prevents duplicate sends including crash after provider send", () => {
    const ledger = new SendIdempotencyLedger();
    expect(ledger.reserve("send-1")).toBe(true);
    ledger.crashAfterProviderSend("send-1");
    expect(ledger.status("send-1")).toBe("sent_unknown");
    expect(ledger.canRetry("send-1")).toBe(false);
    expect(ledger.reserve("send-1")).toBe(false);
  });
  it("retries with backoff, dead-letters, and recovers explicitly", () => {
    const step = {
      id: "step",
      workspaceId: "workspace",
      runId: "run",
      attempt: 1,
      maxAttempts: 2,
      status: "running" as const,
      availableAt: "2026-01-01T00:00:00.000Z"
    };
    const retry = failDurableStep(
      step,
      { retryable: true, code: "TIMEOUT" },
      "2026-01-01T00:00:00.000Z"
    );
    expect(retry.status).toBe("retrying");
    const dead = failDurableStep(
      { ...retry, status: "running" },
      { retryable: true, code: "TIMEOUT" },
      "2026-01-01T00:01:00.000Z"
    );
    expect(dead.status).toBe("dead_letter");
    const recovered = recoverDeadLetter(dead, "2026-01-01T01:00:00.000Z");
    expect(recovered.ok && recovered.value.status).toBe("queued");
  });
});
