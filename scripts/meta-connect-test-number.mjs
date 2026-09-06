/**
 * Stores a WhatsApp connection built from Meta's free test assets.
 *
 * Embedded Signup cannot be reached until Meta verifies the business and
 * grants Tech Provider status, which is calendar time rather than work. This
 * exists so everything *behind* that gate can be exercised in the meantime:
 * the encryption envelope, the connection row and its audit event, webhook
 * signature verification, ingestion, normalisation, dedupe, the outbox relay,
 * and the conversation appearing in /inbox and /crm. None of that has ever run
 * against a real provider.
 *
 * Get the inputs from the app dashboard under WhatsApp -> API Setup. Meta
 * issues a test number, its phone number id, a test WABA id and a 24-hour
 * token to every app, with no verification and no review.
 *
 * What this deliberately does NOT prove: the Embedded Signup dialog, the
 * postMessage capture, and the authorization-code exchange. Those are the
 * three steps this script skips over, so they stay mock-tested only. It proves
 * everything downstream of them and nothing upstream.
 *
 *   node --env-file=.env.local scripts/meta-connect-test-number.mjs
 *
 * Never deployed, never imported by the application. A script that can write a
 * provider credential should not be reachable over HTTP, which is the whole
 * reason this is not a route.
 */
import { createServer } from "vite";

const bold = (value) => `[1m${value}[0m`;
const ok = (value) => `[32m✓[0m ${value}`;
const step = (value) => `[36m→[0m ${value}`;

function fail(message) {
  process.stderr.write(`[31m✗[0m ${message}\n`);
  process.exit(1);
}

/** Masks a credential for display. The value itself is never printed. */
const suffix = (value) => `…${value.slice(-4)}`;

// ---------------------------------------------------------------------------
// Guards, before anything is loaded or contacted.
// ---------------------------------------------------------------------------

if (process.env.APP_DEPLOYMENT_MODE === "production" || process.env.NODE_ENV === "production") {
  fail("Refusing to run against a production configuration.");
}

const token = process.env.META_TEST_TOKEN;
const wabaId = process.env.META_TEST_WABA_ID;
const phoneNumberId = process.env.META_TEST_PHONE_ID;

if (!token || !wabaId || !phoneNumberId) {
  fail(
    "Set META_TEST_TOKEN, META_TEST_WABA_ID and META_TEST_PHONE_ID.\n" +
      "  All three come from the app dashboard under WhatsApp -> API Setup."
  );
}
if (!/^\d{5,40}$/.test(wabaId) || !/^\d{5,40}$/.test(phoneNumberId)) {
  fail("META_TEST_WABA_ID and META_TEST_PHONE_ID are numeric identifiers.");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const hosted = !/localhost|127\.0\.0\.1/.test(supabaseUrl);
if (hosted && process.env.META_TEST_ALLOW_HOSTED !== "true") {
  fail(
    `This would write to a hosted project (${supabaseUrl.replace(/https?:\/\//, "")}).\n` +
      "  Re-run with META_TEST_ALLOW_HOSTED=true if that is what you intend."
  );
}

// ---------------------------------------------------------------------------
// Load the application's own modules, so the credential is encrypted and the
// row is shaped by the code that does it in production rather than by a copy.
// ---------------------------------------------------------------------------

const server = await createServer({
  configFile: "vitest.config.ts",
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error"
});

let result;
try {
  const { getServerEnvironment } = await server.ssrLoadModule("/src/lib/env.ts");
  const { createSupabaseAdminClient } = await server.ssrLoadModule("/src/lib/supabase/admin.ts");
  const { storeLiveMetaConnection } = await server.ssrLoadModule(
    "/src/modules/integrations/meta/connection-service.ts"
  );

  const environment = getServerEnvironment();
  if (!environment.credentialEncryptionKey) {
    fail("CREDENTIAL_ENCRYPTION_KEY is required to store a live token.");
  }
  const graphVersion = environment.metaGraphApiVersion ?? "v25.0";

  // Confirm the pair is real before storing it. storeLiveMetaConnection does
  // not check, and a connection pointing at assets that do not exist fails
  // later, somewhere less obvious.
  process.stdout.write(`${step(`verifying assets against Graph ${graphVersion}`)}\n`);
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${wabaId}/phone_numbers?fields=id,display_phone_number`,
    { headers: { authorization: `Bearer ${token}` }, redirect: "error" }
  );
  if (!response.ok) {
    fail(
      `Graph refused the request (${response.status}). The token may have expired — ` +
        "the dashboard one lasts 24 hours."
    );
  }
  const phones = await response.json();
  const phone = (phones.data ?? []).find((row) => String(row.id) === phoneNumberId);
  if (!phone) {
    const seen = (phones.data ?? []).map((row) => row.id).join(", ") || "none";
    fail(`Phone ${phoneNumberId} is not on WABA ${wabaId}. That WABA lists: ${seen}.`);
  }
  process.stdout.write(`${ok(`phone ${phone.display_phone_number ?? phoneNumberId} found`)}\n`);

  // Resolve a workspace and an owner to attribute the audit event to. The
  // application resolves these from a session; a script has none, so it reads
  // them directly and constructs the same trusted shape.
  const admin = await createSupabaseAdminClient();
  const wanted = process.env.META_TEST_WORKSPACE;
  const { data: workspaces, error: workspaceError } = await admin
    .from("workspaces")
    .select("id,name");
  if (workspaceError) fail(`Could not read workspaces: ${workspaceError.message}`);
  const candidates = wanted
    ? workspaces.filter((row) => row.id === wanted || row.name === wanted)
    : workspaces;
  if (candidates.length === 0) fail(`No workspace matched ${wanted ?? "(any)"}.`);
  if (candidates.length > 1) {
    fail(
      `${candidates.length} workspaces exist. Name one with META_TEST_WORKSPACE:\n` +
        candidates.map((row) => `    ${row.name}  (${row.id})`).join("\n")
    );
  }
  const workspace = candidates[0];

  const { data: membership, error: membershipError } = await admin
    .from("workspace_memberships")
    .select("user_id,role")
    .eq("workspace_id", workspace.id)
    .eq("status", "active")
    .in("role", ["owner", "admin"])
    .limit(1)
    .maybeSingle();
  if (membershipError || !membership) {
    fail("No active owner or admin on that workspace to attribute the change to.");
  }

  result = await storeLiveMetaConnection(
    { id: workspace.id, name: workspace.name, userId: membership.user_id, role: membership.role },
    {
      channel: "whatsapp",
      providerAccountId: phoneNumberId,
      displayName: phone.display_phone_number ?? `WhatsApp ${phoneNumberId.slice(-4)}`,
      accessToken: token,
      permissions: ["whatsapp_business_management", "whatsapp_business_messaging"],
      wabaId,
      phoneNumberId
    }
  );

  process.stdout.write(`${ok(`token encrypted (suffix ${suffix(token)})`)}\n`);
  process.stdout.write(
    `${ok(`connection stored  workspace=${bold(workspace.name)}  channel=whatsapp`)}\n`
  );
} finally {
  await server.close();
}

process.stdout.write(`\n${bold("Next")}\n`);
process.stdout.write(
  "  Point the webhook at https://app.rellooma.com/api/webhooks/meta in the app\n" +
    "  dashboard, then message the test number. The event should reach /inbox.\n"
);
if (process.env.META_CONNECTION_MODE !== "live") {
  process.stdout.write(
    "\n  Note: META_CONNECTION_MODE is not 'live', so /connections still renders\n" +
      "  the sandbox affordances. The stored row is a live one regardless.\n"
  );
}
process.stdout.write(`\n  connection id ${result.id ?? "(unknown)"}\n`);
