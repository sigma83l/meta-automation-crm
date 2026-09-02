import { spawnSync } from "node:child_process";

const status = spawnSync("pnpm", ["exec", "supabase", "status", "-o", "env"], {
  encoding: "utf8"
});
if (status.status !== 0) {
  process.stderr.write("Local Supabase is unavailable. Run `pnpm db:start` first.\n");
  process.exit(status.status ?? 1);
}

const local = Object.fromEntries(
  status.stdout
    .split("\n")
    .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]])
);
const command = process.argv[2];
const args = process.argv.slice(3);
if (!command || !local.API_URL || !local.ANON_KEY || !local.SERVICE_ROLE_KEY) {
  process.stderr.write("Local Supabase status was incomplete.\n");
  process.exit(1);
}

const result = spawnSync(command, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
    ENABLE_EMAIL_CONFIRMATION: "false",
    AUTH_CAPTCHA_MODE: "fake",
    // Cleared, not left alone. The captcha mode above is a server setting; the
    // form decides whether to render a Turnstile widget from this key, which
    // Next inlines from `.env.local` if it is there. A developer with a real
    // key in that file therefore gets the real widget - unsolvable headless -
    // while the server is in fake mode, and every signup in the suite hangs on
    // a disabled button. CI has no `.env.local` and so never saw it.
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
    // For the same reason. Every E2E journey starts by creating a workspace
    // through the form, so a local `.env.local` shaped like production - where
    // invite_only is the correct setting - turns the whole suite into one
    // repeated "account creation is disabled" assertion.
    AUTH_SIGNUP_MODE: "self_service",
    AUTH_RATE_LIMIT_MAX_ATTEMPTS: process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS ?? "100",
    AUTH_RATE_LIMIT_WINDOW_SECONDS: "60"
  }
});
process.exit(result.status ?? 1);
