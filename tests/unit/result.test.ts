import { describe, expect, it } from "vitest";
import { appError, err, ok } from "@/src/lib/result";

describe("Result contract", () => {
  it("returns immutable success values", () => {
    const result = ok({ workspaceId: "ws_synthetic" });

    expect(result).toEqual({ ok: true, value: { workspaceId: "ws_synthetic" } });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("returns stable, non-secret error details", () => {
    const result = err(
      appError("LIVE_SEND_BLOCKED", "Live provider send is blocked.", {
        details: { missing: "explicit approval" }
      })
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "LIVE_SEND_BLOCKED",
        message: "Live provider send is blocked.",
        retryable: false,
        details: { missing: "explicit approval" }
      }
    });
    if (!result.ok) {
      expect(Object.isFrozen(result.error)).toBe(true);
    }
  });
});
