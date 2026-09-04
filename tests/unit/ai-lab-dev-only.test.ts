import { afterEach, describe, expect, it, vi } from "vitest";
import { devOnlyEnabled } from "@/src/modules/ai-lab/dev-only";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the AI lab's production guard", () => {
  it("is closed in a production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(devOnlyEnabled()).toBe(false);
  });

  it("is open in development and test", () => {
    for (const environment of ["development", "test"] as const) {
      vi.stubEnv("NODE_ENV", environment);
      expect(devOnlyEnabled()).toBe(true);
    }
  });

  // A preview deployment is not a production build but is reachable from the
  // internet, so NODE_ENV alone would leave the lab open on every one of them.
  it("is closed on a Vercel deployment even outside a production build", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "1");
    expect(devOnlyEnabled()).toBe(false);
  });

  it("stays open locally, where VERCEL is unset", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    expect(devOnlyEnabled()).toBe(true);
  });
});
