import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const CSRF_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-relay-csrf" : "relay-csrf";

export function createCsrfToken() {
  return randomBytes(32).toString("base64url");
}

export function verifyCsrf(request: NextRequest) {
  const cookie = request.cookies.get(CSRF_COOKIE)?.value;
  const header = request.headers.get("x-csrf-token");
  if (!cookie || !header) return false;
  return timingSafeEqual(
    createHash("sha256").update(cookie).digest(),
    createHash("sha256").update(header).digest()
  );
}
