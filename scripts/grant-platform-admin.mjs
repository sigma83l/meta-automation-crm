/**
 * Grants platform staff access to one existing account.
 *
 * This is the only way the first `platform_owner` can come into existence, and
 * that is deliberate. The console can promote people once somebody holds the
 * owner role, but the first grant has to come from outside the application: a
 * bootstrap path that ran inside the app — an environment allowlist, a magic
 * email, a "first user wins" rule — would mean one misconfigured variable in a
 * deployed environment is a cross-tenant superuser, and none of those mistakes
 * announce themselves.
 *
 * Requires the service-role key, so running it is already gated on holding the
 * most privileged credential the deployment has.
 *
 *   node --env-file=.env.local scripts/grant-platform-admin.mjs \
 *     --email you@example.com --role platform_owner --reason "founding owner"
 *
 * Pass --list to see who currently holds access and change nothing.
 */

import { createClient } from "@supabase/supabase-js";

const ROLES = ["platform_support", "platform_admin", "platform_owner"];

function argOf(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !serviceKey) {
  fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.");
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

/** Masked, as everywhere else: this script prints to a terminal and to CI logs. */
function maskEmail(email) {
  if (!email) return "—";
  const at = email.lastIndexOf("@");
  return at <= 0 ? "•••" : `${email.slice(0, 1)}•••${email.slice(at)}`;
}

async function list() {
  const { data, error } = await db
    .from("platform_admins")
    .select("user_id,role,status,granted_reason,created_at")
    .order("created_at");
  if (error) fail(`Could not read platform_admins: ${error.message}`);
  if ((data ?? []).length === 0) {
    console.log("No platform staff are configured.");
    return;
  }
  const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailById = new Map((users?.users ?? []).map((user) => [user.id, user.email]));
  for (const row of data) {
    console.log(
      [
        row.status === "active" ? "●" : "○",
        row.role.padEnd(17),
        maskEmail(emailById.get(row.user_id)).padEnd(28),
        row.granted_reason
      ].join(" ")
    );
  }
}

async function grant() {
  const email = argOf("email")?.trim().toLowerCase();
  const role = argOf("role")?.trim() ?? "platform_support";
  const reason = argOf("reason")?.trim();

  if (!email) fail("--email is required.");
  if (!ROLES.includes(role)) fail(`--role must be one of: ${ROLES.join(", ")}`);
  if (!reason || reason.length < 3) fail("--reason is required (at least 3 characters).");

  // The account must already exist. Creating one here would put account
  // provisioning — profile, workspace, ownership, safe defaults, all of which
  // the signup transaction does together — into a script that knows about none
  // of it.
  const { data: users, error: usersError } = await db.auth.admin.listUsers({
    page: 1,
    perPage: 1000
  });
  if (usersError) fail(`Could not read accounts: ${usersError.message}`);
  const user = (users?.users ?? []).find((row) => (row.email ?? "").toLowerCase() === email);
  if (!user) fail("No account with that address. Have them sign up first, then rerun this.");

  const { data: profile } = await db.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (!profile) fail("That account has no profile row; its signup did not complete.");

  const { error } = await db.from("platform_admins").upsert(
    {
      user_id: user.id,
      role,
      status: "active",
      granted_reason: reason,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
  if (error) fail(`Grant failed: ${error.message}`);

  // Recorded in the same ledger as every console action. `granted_by` is null
  // here and only here — there is no signed-in actor to attribute a bootstrap
  // to, and inventing one would be worse than the gap.
  const { error: auditError } = await db.from("platform_admin_audit_events").insert({
    actor_id: null,
    actor_role: role,
    action: "staff.bootstrapped",
    target_user_id: user.id,
    safe_details: { role, reason, via: "grant-platform-admin.mjs" }
  });
  if (auditError) console.warn(`! Ledger write failed: ${auditError.message}`);

  console.log(`✓ ${maskEmail(user.email)} is now ${role}.`);
}

if (process.argv.includes("--list")) {
  await list();
} else {
  await grant();
}
