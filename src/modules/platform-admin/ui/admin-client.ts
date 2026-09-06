"use client";

/**
 * The console's one way to reach the server.
 *
 * A fresh CSRF token per request rather than one held for the session: the
 * cookie the token pairs with lives 30 minutes, and a console tab left open on
 * a second monitor all afternoon is the normal case here, not the exception.
 * Fetching per action costs one round trip and removes a whole class of "the
 * form expired" that staff would otherwise hit at the worst moment.
 */
async function csrf() {
  return ((await fetch("/api/auth/csrf").then((r) => r.json())) as { token: string }).token;
}

export type AdminActionResult = Readonly<{ ok: boolean; message?: string }>;

export async function adminAction(
  endpoint: string,
  body: Record<string, unknown>
): Promise<AdminActionResult> {
  try {
    const response = await fetch(`/api/admin/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
      body: JSON.stringify(body)
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    if (!response.ok) {
      // The server's refusals are written for staff and name the actual
      // constraint ("a workspace must keep at least one active owner"), so they
      // are surfaced rather than replaced with a generic failure.
      return { ok: false, message: payload.message ?? payload.error ?? "Action failed." };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "The server is unavailable. Try again." };
  }
}
