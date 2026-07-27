import { appError, err, ok, type Result } from "@/src/lib/result";

export type SendAuthorization = Readonly<{
  mode: "sandbox" | "live";
  environmentEnabled: boolean;
  explicitApproval: boolean;
  recipientAllowlisted: boolean;
}>;

export function authorizeOutboundSend(input: SendAuthorization): Result<"SANDBOX" | "LIVE"> {
  if (input.mode === "sandbox") {
    return ok("SANDBOX");
  }

  const missing = [
    !input.environmentEnabled ? "environment gate" : null,
    !input.explicitApproval ? "explicit approval" : null,
    !input.recipientAllowlisted ? "recipient allowlist" : null
  ].filter((value): value is string => value !== null);

  if (missing.length > 0) {
    return err(
      appError("LIVE_SEND_BLOCKED", "Live provider send is blocked.", {
        details: { missing: missing.join(", ") }
      })
    );
  }

  return ok("LIVE");
}
