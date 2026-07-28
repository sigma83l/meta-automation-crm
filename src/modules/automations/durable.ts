import { appError, err, ok, type Result } from "@/src/lib/result";
export type DurableStep = Readonly<{
  id: string;
  workspaceId: string;
  runId: string;
  attempt: number;
  maxAttempts: number;
  status: "queued" | "running" | "completed" | "retrying" | "dead_letter" | "cancelled";
  availableAt: string;
}>;
export function failDurableStep(
  step: DurableStep,
  error: { retryable: boolean; code: string },
  now: string
): DurableStep {
  if (!error.retryable || step.attempt >= step.maxAttempts)
    return { ...step, status: "dead_letter" };
  const delay = Math.min(3600, 2 ** step.attempt * 5);
  return {
    ...step,
    status: "retrying",
    attempt: step.attempt + 1,
    availableAt: new Date(new Date(now).getTime() + delay * 1000).toISOString()
  };
}
export function recoverDeadLetter(step: DurableStep, now: string): Result<DurableStep> {
  if (step.status !== "dead_letter")
    return err(appError("VALIDATION_ERROR", "Only dead letters may be recovered."));
  return ok({ ...step, status: "queued", attempt: 1, availableAt: now });
}
export class SendIdempotencyLedger {
  private readonly keys = new Map<string, "reserved" | "sent" | "sent_unknown">();
  reserve(key: string) {
    if (this.keys.has(key)) return false;
    this.keys.set(key, "reserved");
    return true;
  }
  sent(key: string) {
    if (this.keys.get(key) !== "reserved") return false;
    this.keys.set(key, "sent");
    return true;
  }
  crashAfterProviderSend(key: string) {
    if (this.keys.get(key) === "reserved") this.keys.set(key, "sent_unknown");
  }
  canRetry(key: string) {
    return !this.keys.has(key);
  }
  status(key: string) {
    return this.keys.get(key);
  }
}
export const durableAutomationContract = Object.freeze({
  event: "automation/run.requested",
  concurrencyKey: "workspaceId",
  workspaceLimit: 4,
  providerLimit: 8,
  waits: "durable",
  retries: "bounded_exponential"
});
