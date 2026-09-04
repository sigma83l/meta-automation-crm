import { afterEach, describe, expect, it, vi } from "vitest";
import { devOnlyEnabled, localDatabaseOnly } from "@/src/modules/ai-lab/dev-only";

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

/**
 * The second half of the guard, and the one that matters most in this repo:
 * the committed `.env.local` names the live Supabase project, so "this is a
 * developer's machine" and "this is a developer's data" are not the same
 * question and the lab has to ask both.
 */
describe("the AI lab's local-database requirement", () => {
  it("accepts the local Supabase", () => {
    for (const url of ["http://127.0.0.1:54321", "http://localhost:54321"]) {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      expect(localDatabaseOnly()).toBe(true);
    }
  });

  it("refuses a hosted project", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://qsvoxpnfxvikannfdybr.supabase.co");
    expect(localDatabaseOnly()).toBe(false);
  });

  // A prefix comparison would accept this: it is a remote host whose name
  // begins with the one that is allowed.
  it("refuses a remote host that merely starts with localhost", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://localhost.example.com");
    expect(localDatabaseOnly()).toBe(false);
  });

  it("refuses an unset or unreadable url rather than assuming local", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(localDatabaseOnly()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not a url");
    expect(localDatabaseOnly()).toBe(false);
  });
});
