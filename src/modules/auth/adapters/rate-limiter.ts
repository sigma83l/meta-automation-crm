import { appError, err, ok, type Result } from "@/src/lib/result";

import type { RateLimiter } from "../contracts";

type Window = { count: number; expiresAt: number };

export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly maximum: number,
    private readonly windowMilliseconds: number,
    private readonly maximumKeys = 10_000
  ) {}

  consume(key: string, now = Date.now()): Result<void> {
    if (this.windows.size >= this.maximumKeys) {
      for (const [candidate, window] of this.windows) {
        if (window.expiresAt <= now) this.windows.delete(candidate);
      }
    }
    const current = this.windows.get(key);
    if (!current || current.expiresAt <= now) {
      this.windows.set(key, { count: 1, expiresAt: now + this.windowMilliseconds });
      return ok(undefined);
    }
    if (current.count >= this.maximum) {
      return err(
        appError("AUTH_RATE_LIMITED", "Too many attempts. Try again shortly.", {
          retryable: true
        })
      );
    }
    current.count += 1;
    return ok(undefined);
  }
}

export class DatabaseRateLimiter implements RateLimiter {
  constructor(
    private readonly client: SupabaseClient,
    private readonly maximum: number,
    private readonly windowSeconds: number,
    private readonly hashKey: string
  ) {}

  async consume(key: string): Promise<Result<void>> {
    const keyHash = createHmac("sha256", this.hashKey).update(key).digest("hex");
    const { data, error } = await this.client.rpc("consume_auth_rate_limit", {
      requested_key_hash: keyHash,
      requested_maximum: this.maximum,
      requested_window_seconds: this.windowSeconds
    });
    if (error || data !== true) {
      return err(
        appError("AUTH_RATE_LIMITED", "Too many attempts. Try again shortly.", {
          retryable: true
        })
      );
    }
    return ok(undefined);
  }
}
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
