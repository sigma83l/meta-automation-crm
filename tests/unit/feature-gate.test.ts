import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { featureKeys, platformSwitchKeys } from "@/src/modules/features/contracts";
import {
  isFeatureEnabled,
  isPlatformSwitchEnabled,
  loadFeatureMap
} from "@/src/modules/features/server/gate";

/**
 * The gate the product asks before offering a capability.
 *
 * Every assertion here is about the same property: it fails closed. A read
 * error, a missing row, an unknown key — each answers "no". The alternative is
 * that a transient database blip hands a workspace a capability its plan never
 * included, and nothing surfaces that until it appears on an invoice.
 */

const rpcClient = (data: unknown, error: unknown = null) =>
  ({ rpc: vi.fn().mockResolvedValue({ data, error }) }) as unknown as SupabaseClient;

describe("isFeatureEnabled", () => {
  it("passes the workspace and key straight to the one resolver", async () => {
    const client = rpcClient(true);
    await isFeatureEnabled(client, "ws-1", "crm_import");
    expect(client.rpc).toHaveBeenCalledWith("workspace_feature_enabled", {
      target_workspace_id: "ws-1",
      target_flag_key: "crm_import"
    });
  });

  it("answers true only for an explicit true", async () => {
    expect(await isFeatureEnabled(rpcClient(true), "ws-1", "crm_import")).toBe(true);
    for (const value of [false, null, undefined, "true", 1]) {
      expect(await isFeatureEnabled(rpcClient(value), "ws-1", "crm_import")).toBe(false);
    }
  });

  it("answers false when the read fails", async () => {
    expect(
      await isFeatureEnabled(rpcClient(true, { message: "connection reset" }), "ws-1", "ai_replies")
    ).toBe(false);
  });
});

describe("loadFeatureMap", () => {
  it("reads every flag in one call", async () => {
    const client = rpcClient([
      { flag_key: "crm_import", enabled: true },
      { flag_key: "ai_replies", enabled: false }
    ]);
    const map = await loadFeatureMap(client, "ws-1");
    expect(map.crm_import).toBe(true);
    expect(map.ai_replies).toBe(false);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("returns an empty map on failure, so every key reads as off", async () => {
    const map = await loadFeatureMap(rpcClient(null, { message: "boom" }), "ws-1");
    expect(map).toEqual({});
    for (const key of featureKeys) {
      expect(map[key] ?? false).toBe(false);
    }
  });
});

describe("isPlatformSwitchEnabled", () => {
  const switchClient = (data: unknown, error: unknown = null) =>
    ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data, error }) }) })
      })
    }) as unknown as SupabaseClient;

  it("treats an unreadable or missing switch as blocked", async () => {
    // The bias that matters: a switch nobody can read must not read as
    // permission. `live_provider_send` is the reason — an outage that made this
    // return true would remove a block during exactly the wrong minute.
    expect(await isPlatformSwitchEnabled(switchClient(null), "live_provider_send")).toBe(false);
    expect(
      await isPlatformSwitchEnabled(
        switchClient({ enabled: true }, { message: "down" }),
        "ai_replies"
      )
    ).toBe(false);
  });

  it("permits only on an explicit true", async () => {
    expect(await isPlatformSwitchEnabled(switchClient({ enabled: true }), "public_signup")).toBe(
      true
    );
    expect(await isPlatformSwitchEnabled(switchClient({ enabled: false }), "public_signup")).toBe(
      false
    );
  });

  it("covers every declared switch key", async () => {
    for (const key of platformSwitchKeys) {
      expect(await isPlatformSwitchEnabled(switchClient({ enabled: true }), key)).toBe(true);
    }
  });
});
