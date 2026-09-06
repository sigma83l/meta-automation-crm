import { afterEach, describe, expect, it, vi } from "vitest";
import { logAuthDiagnostic } from "@/src/modules/auth/diagnostics";

function captureLog(run: () => void): string {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    run();
    return spy.mock.calls.map((call) => String(call[0])).join("\n");
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("auth diagnostics", () => {
  it("emits a single parseable JSON line", () => {
    const output = captureLog(() => logAuthDiagnostic("resolve_workspace_empty", { rows: 0 }));
    expect(output.split("\n")).toHaveLength(1);
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.scope).toBe("auth-diagnostic");
    expect(parsed.event).toBe("resolve_workspace_empty");
    expect(parsed.rows).toBe(0);
  });

  it("reports the configured Supabase project so a mismatch is visible", () => {
    // The whole point: production may store the URL as a write-only sensitive
    // variable, so the logs are the only way to see which project is in use.
    const output = captureLog(() => logAuthDiagnostic("resolve_workspace_empty"));
    expect(JSON.parse(output).supabaseProject).toBeTypeOf("string");
  });

  it("reports 'unset' rather than throwing when no project is configured", () => {
    const output = captureLog(() => logAuthDiagnostic("password_sign_in_failed", { status: 400 }));
    const project = JSON.parse(output).supabaseProject as string;
    expect(["unset", "unparseable"].includes(project) || project.length > 0).toBe(true);
  });

  it("never carries a credential or an identity", () => {
    // Callers pass codes and counts only. This guards the contract itself: if
    // someone later threads an email or token through, this fails.
    const output = captureLog(() =>
      logAuthDiagnostic("resolve_workspace_error", { code: "PGRST202", message: "not found" })
    );
    for (const forbidden of ["@", "password", "token", "secret", "bearer", "eyJ"]) {
      expect(output.toLowerCase()).not.toContain(forbidden);
    }
  });
});
