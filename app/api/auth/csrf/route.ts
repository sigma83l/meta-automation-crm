import { NextResponse } from "next/server";

import { CSRF_COOKIE, createCsrfToken } from "@/src/modules/auth/security/csrf";

export async function GET() {
  const token = createCsrfToken();
  const response = NextResponse.json({ token });
  response.cookies.set(CSRF_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 30
  });
  return response;
}
