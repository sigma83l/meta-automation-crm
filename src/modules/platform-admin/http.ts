import { NextResponse, type NextRequest } from "next/server";

import { requireCsrf } from "@/src/modules/auth/security/route";

import type { PlatformCapability } from "./contracts";
import { createPlatformAdminRuntime, PlatformAdminError } from "./server/runtime";
import type { PlatformAdminRuntime } from "./server/runtime";

/**
 * Turns a console failure into a response.
 *
 * `NOT_STAFF` answers 404, not 403. A signed-in customer probing `/api/admin/*`
 * should not be able to tell the difference between "this endpoint is not for
 * you" and "this endpoint does not exist" — the second leaks nothing about how
 * the console is laid out, and the people who need the real answer are already
 * past this branch. `FORBIDDEN` is 403, because by then the caller is known
 * staff and telling them their role is too low is useful rather than leaky.
 */
export function platformAdminErrorResponse(error: unknown) {
  if (error instanceof PlatformAdminError) {
    return error.reason === "NOT_STAFF"
      ? NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
      : NextResponse.json({ error: "PLATFORM_ROLE_REQUIRED" }, { status: 403 });
  }
  // Everything else is a validation refusal from a module — the reason strings
  // are written for staff and contain no customer data, so they are returned
  // rather than swallowed into a generic failure.
  const message = error instanceof Error ? error.message : "The request could not be completed.";
  return NextResponse.json({ error: "PLATFORM_ACTION_FAILED", message }, { status: 400 });
}

/**
 * The wrapper every console mutation route uses: CSRF, then staff identity and
 * capability, then the handler. Ordering matters — CSRF is checked before
 * anything reads the database, so a cross-site POST costs a query nothing.
 */
export async function withPlatformAdmin(
  request: NextRequest,
  capability: PlatformCapability,
  handler: (runtime: PlatformAdminRuntime, body: Record<string, unknown>) => Promise<unknown>
) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const runtime = await createPlatformAdminRuntime(capability);
    const value = await handler(runtime, body);
    return NextResponse.json({ ok: true, value: value ?? null });
  } catch (error) {
    return platformAdminErrorResponse(error);
  }
}

export function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }
  return value.trim();
}

export function requiredBoolean(body: Record<string, unknown>, key: string): boolean {
  const value = body[key];
  if (typeof value !== "boolean") throw new Error(`${key} must be true or false.`);
  return value;
}

export function optionalInteger(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${key} must be a whole number.`);
  return parsed;
}
