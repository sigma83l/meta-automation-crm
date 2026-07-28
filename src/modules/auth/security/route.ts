import type { NextRequest } from "next/server";

import { appError, err } from "@/src/lib/result";

import { resultResponse } from "../http";
import { verifyCsrf } from "./csrf";

export function requireCsrf(request: NextRequest) {
  return verifyCsrf(request)
    ? null
    : resultResponse(err(appError("AUTH_CSRF_FAILED", "Invalid CSRF token.")));
}
