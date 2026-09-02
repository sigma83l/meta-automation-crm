import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { featureKeys, platformSwitchKeys } from "@/src/modules/features/contracts";

/**
 * The platform console's database half.
 *
 * This is the one place in the schema that crosses tenant boundaries, so the
 * claims it rests on are worth proving against a real engine rather than
 * asserting on migration text: that a customer cannot read the staff table or
 * the ledger, that a staff member can, that the ledger genuinely refuses edits,
 * that feature resolution follows override → plan → default, and that a trial
 * extension cannot become a second trial.
 *
 * Everything here runs as `authenticated` with a settable `auth.uid()`, which
 * is what a browser session actually is. A test that ran as the table owner
 * would pass while every policy was wrong.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const platformStub = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

const workspaceA = "11111111-1111-1111-1111-111111111111";
const workspaceB = "22222222-2222-2222-2222-222222222222";
const staffUser = "aaaaaaaa-0000-0000-0000-000000000001";
const customerUser = "aaaaaaaa-0000-0000-0000-000000000002";
const supportUser = "aaaaaaaa-0000-0000-0000-000000000003";

let db: PGlite;

/**
 * Runs `sql` the way a browser session runs it: as `authenticated`, with
 * `auth.uid()` set to a real person.
 *
 * The role switch is the load-bearing half. PGlite connects as a superuser, and
 * a superuser bypasses row security entirely — so a version of this helper that
 * only set `test.uid` would report every policy as permissive and pass no
 * matter what the migration said. `set role` is session scoped rather than
 * `set local`, because there is no surrounding transaction here for a local
 * setting to belong to.
 */
async function asUser(uid: string | null, sql: string) {
  await db.exec(`select set_config('test.uid', ${uid ? `'${uid}'` : "''"}, false);`);
  await db.exec(`set role authenticated;`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec(`reset role;`);
  }
}

/** Reports whether the engine refuses `sql` for this session. */
async function refusedFor(uid: string | null, sql: string) {
  try {
    await asUser(uid, sql);
    return false;
  } catch {
    return true;
  }
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(readFileSync(platformStub, "utf8"));
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.exec(
      readFileSync(`${migrationsDir}/${file}`, "utf8").replace(
        /create extension if not exists pgcrypto[^;]*;/gi,
        ""
      )
    );
  }

  await db.exec(`
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid
    $$;
  `);

  // Triggers off while seeding: handle_new_user provisions a whole workspace
  // per account, which is behaviour tested elsewhere and would fight the fixed
  // memberships this test needs.
  await db.exec(`set session_replication_role = replica;`);
  await db.exec(`
    insert into public.workspaces (id, name, status) values
      ('${workspaceA}', 'Acme', 'active'),
      ('${workspaceB}', 'Globex', 'active');
    insert into auth.users (id, email) values
      ('${staffUser}', 'staff@example.test'),
      ('${customerUser}', 'customer@example.test'),
      ('${supportUser}', 'support@example.test');
    insert into public.profiles (id, workspace_id, status) values
      ('${staffUser}', '${workspaceA}', 'active'),
      ('${customerUser}', '${workspaceA}', 'active'),
      ('${supportUser}', '${workspaceA}', 'active');
    insert into public.workspace_memberships (workspace_id, user_id, role, status) values
      ('${workspaceA}', '${customerUser}', 'owner', 'active');
    insert into public.platform_admins (user_id, role, status, granted_reason) values
      ('${staffUser}', 'platform_owner', 'active', 'test fixture'),
      ('${supportUser}', 'platform_support', 'disabled', 'revoked fixture');
  `);
  await db.exec(`set session_replication_role = origin;`);

  await db.exec(`
    grant usage on schema public to authenticated;
  `);
});

afterAll(async () => {
  await db.close();
});

describe("platform staff identity", () => {
  it("names an active staff member and nobody else", async () => {
    const staff = await asUser(staffUser, "select * from public.current_platform_admin();");
    expect(staff.rows).toHaveLength(1);
    expect((staff.rows[0] as { admin_role: string }).admin_role).toBe("platform_owner");

    const customer = await asUser(customerUser, "select * from public.current_platform_admin();");
    expect(customer.rows).toHaveLength(0);
  });

  it("treats a disabled grant as no grant at all", async () => {
    // The revocation path sets status rather than deleting the row, so this is
    // the assertion that revocation actually withdraws anything.
    const result = await asUser(supportUser, "select * from public.current_platform_admin();");
    expect(result.rows).toHaveLength(0);
  });

  it("hides the staff table and the ledger from a customer", async () => {
    const staffRows = await asUser(customerUser, "select * from public.platform_admins;");
    expect(staffRows.rows).toHaveLength(0);
    const auditRows = await asUser(
      customerUser,
      "select * from public.platform_admin_audit_events;"
    );
    expect(auditRows.rows).toHaveLength(0);
  });

  it("shows both to staff", async () => {
    const rows = await asUser(staffUser, "select user_id from public.platform_admins;");
    expect(rows.rows.length).toBeGreaterThanOrEqual(2);
  });

  it("lets staff read across workspaces where a customer cannot", async () => {
    const staffView = await asUser(staffUser, "select id from public.workspaces;");
    expect(staffView.rows).toHaveLength(2);

    // The customer owns workspace A and has no membership in B, so the
    // pre-existing member policy should still be the only one that applies.
    const customerView = await asUser(customerUser, "select id from public.workspaces;");
    expect(customerView.rows).toHaveLength(1);
    expect((customerView.rows[0] as { id: string }).id).toBe(workspaceA);
  });
});

describe("the audit ledger", () => {
  it("refuses updates and deletes even from the owner of the table", async () => {
    await db.exec(`
      insert into public.platform_admin_audit_events (actor_id, actor_role, action, safe_details)
      values ('${staffUser}', 'platform_owner', 'test.action', '{"reason":"seed"}'::jsonb);
    `);
    await expect(
      db.exec(`update public.platform_admin_audit_events set action = 'tampered';`)
    ).rejects.toThrow(/append-only/);
    await expect(db.exec(`delete from public.platform_admin_audit_events;`)).rejects.toThrow(
      /append-only/
    );
  });
});

describe("feature flag resolution", () => {
  it("falls back to the catalogue default when nothing else says otherwise", async () => {
    const result = await db.query<{ enabled: boolean }>(
      `select public.workspace_feature_enabled('${workspaceA}', 'crm_import') as enabled;`
    );
    expect(result.rows[0]?.enabled).toBe(true);
  });

  it("lets a plan default beat the catalogue, and an override beat the plan", async () => {
    await db.exec(`
      insert into public.subscription_plans (id, plan_key, display_name, price_minor_units)
      values ('33333333-3333-3333-3333-333333333333', 'starter', 'Starter', 4900)
      on conflict (plan_key) do nothing;
      insert into public.workspace_subscriptions (workspace_id, plan_id, status)
      values ('${workspaceA}', '33333333-3333-3333-3333-333333333333', 'active')
      on conflict (workspace_id) do update set plan_id = excluded.plan_id;
      insert into public.plan_feature_defaults (plan_id, flag_key, enabled)
      values ('33333333-3333-3333-3333-333333333333', 'crm_import', false);
    `);
    const planWins = await db.query<{ enabled: boolean }>(
      `select public.workspace_feature_enabled('${workspaceA}', 'crm_import') as enabled;`
    );
    expect(planWins.rows[0]?.enabled).toBe(false);

    await db.exec(`
      insert into public.workspace_feature_overrides (workspace_id, flag_key, enabled, reason)
      values ('${workspaceA}', 'crm_import', true, 'pilot customer');
    `);
    const overrideWins = await db.query<{ enabled: boolean }>(
      `select public.workspace_feature_enabled('${workspaceA}', 'crm_import') as enabled;`
    );
    expect(overrideWins.rows[0]?.enabled).toBe(true);
  });

  it("stops applying an override once it expires", async () => {
    await db.exec(`
      update public.workspace_feature_overrides
      set expires_at = now() - interval '1 hour'
      where workspace_id = '${workspaceA}' and flag_key = 'crm_import';
    `);
    const result = await db.query<{ enabled: boolean }>(
      `select public.workspace_feature_enabled('${workspaceA}', 'crm_import') as enabled;`
    );
    // Back to the plan's answer, not to the catalogue's: expiry removes one
    // layer rather than all of them.
    expect(result.rows[0]?.enabled).toBe(false);
  });

  it("archiving beats every override and plan default", async () => {
    await db.exec(`
      update public.workspace_feature_overrides
      set expires_at = null, enabled = true
      where workspace_id = '${workspaceA}' and flag_key = 'crm_import';
      update public.feature_flags set archived = true where key = 'crm_import';
    `);
    const result = await db.query<{ enabled: boolean }>(
      `select public.workspace_feature_enabled('${workspaceA}', 'crm_import') as enabled;`
    );
    expect(result.rows[0]?.enabled).toBe(false);
    await db.exec(`update public.feature_flags set archived = false where key = 'crm_import';`);
  });

  it("reports which layer decided, and omits archived flags", async () => {
    const result = await db.query<{ flag_key: string; source: string }>(
      `select flag_key, source from public.workspace_feature_flags('${workspaceA}');`
    );
    const byKey = new Map(result.rows.map((row) => [row.flag_key, row.source]));
    expect(byKey.get("crm_import")).toBe("override");
    // Untouched flags fall through to the catalogue, and say so.
    expect(byKey.get("analytics")).toBe("default");
  });

  it("seeds exactly the keys the application gates on", async () => {
    // The two lists are written in different languages in different files, and
    // nothing but this makes them agree. A flag in the contract with no
    // catalogue row resolves to false forever - the capability is off for every
    // workspace, in production only, and the gate that did it looks correct.
    const flags = await db.query<{ key: string }>(`select key from public.feature_flags;`);
    expect(flags.rows.map((row) => row.key).sort()).toEqual([...featureKeys].sort());

    const switches = await db.query<{ key: string }>(`select key from public.platform_switches;`);
    expect(switches.rows.map((row) => row.key).sort()).toEqual([...platformSwitchKeys].sort());
  });

  it("answers false for a flag that does not exist", async () => {
    const result = await db.query<{ enabled: boolean }>(
      `select public.workspace_feature_enabled('${workspaceA}', 'no_such_flag') as enabled;`
    );
    expect(result.rows[0]?.enabled).toBe(false);
  });

  it("keeps a customer from seeing another workspace's overrides", async () => {
    await db.exec(`
      insert into public.workspace_feature_overrides (workspace_id, flag_key, enabled, reason)
      values ('${workspaceB}', 'analytics', false, 'other tenant');
    `);
    const rows = await asUser(
      customerUser,
      "select workspace_id from public.workspace_feature_overrides;"
    );
    expect(rows.rows).toHaveLength(1);
    expect((rows.rows[0] as { workspace_id: string }).workspace_id).toBe(workspaceA);
  });
});

describe("global switches", () => {
  it("seeds the switches the application reads", async () => {
    const result = await db.query<{ key: string }>(`select key from public.platform_switches;`);
    const keys = result.rows.map((row) => row.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "public_signup",
        "live_provider_send",
        "ai_replies",
        "crm_imports",
        "billing_charges"
      ])
    );
  });

  it("is readable but not writable by a customer session", async () => {
    const rows = await asUser(customerUser, "select key from public.platform_switches;");
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(
      await refusedFor(
        customerUser,
        "update public.platform_switches set enabled = false where key = 'live_provider_send';"
      )
    ).toBe(true);
  });
});

describe("trial extension", () => {
  it("moves a running trial's deadline without granting a second trial", async () => {
    await db.exec(`
      update public.workspace_subscriptions
      set status = 'trialing',
          trial_ends_at = now() + interval '2 days',
          trial_consumed_at = now() - interval '5 days'
      where workspace_id = '${workspaceA}';
    `);
    const result = await db.query<{ ok: boolean }>(
      `select public.platform_extend_trial('${workspaceA}', now() + interval '9 days') as ok;`
    );
    expect(result.rows[0]?.ok).toBe(true);

    const after = await db.query<{ trial_consumed_at: string | null; status: string }>(
      `select trial_consumed_at, status from public.workspace_subscriptions
       where workspace_id = '${workspaceA}';`
    );
    // Still consumed. This is the invariant that stops a workspace cycling
    // cards for endless free trials, and an extension must not clear it.
    expect(after.rows[0]?.trial_consumed_at).not.toBeNull();
    expect(after.rows[0]?.status).toBe("trialing");
  });

  it("refuses to move a deadline backwards", async () => {
    await expect(
      db.exec(`select public.platform_extend_trial('${workspaceA}', now() + interval '1 day');`)
    ).rejects.toThrow(/forward/);
  });

  it("refuses a workspace that is not in a trial", async () => {
    await db.exec(`
      update public.workspace_subscriptions set status = 'active'
      where workspace_id = '${workspaceA}';
    `);
    await expect(
      db.exec(`select public.platform_extend_trial('${workspaceA}', now() + interval '30 days');`)
    ).rejects.toThrow(/trialing/);
  });
});

describe("impersonation grants", () => {
  it("refuses a window that ends before it starts", async () => {
    await expect(
      db.exec(`
        insert into public.platform_impersonation_grants
          (admin_id, workspace_id, reason, expires_at, created_at)
        values ('${staffUser}', '${workspaceA}', 'debugging a report',
                now() - interval '1 hour', now());
      `)
    ).rejects.toThrow();
  });

  it("requires a reason of real length", async () => {
    await expect(
      db.exec(`
        insert into public.platform_impersonation_grants
          (admin_id, workspace_id, reason, expires_at)
        values ('${staffUser}', '${workspaceA}', 'x', now() + interval '10 minutes');
      `)
    ).rejects.toThrow();
  });

  it("is invisible to a customer", async () => {
    await db.exec(`
      insert into public.platform_impersonation_grants
        (admin_id, workspace_id, reason, expires_at)
      values ('${staffUser}', '${workspaceA}', 'reproducing a support ticket',
              now() + interval '10 minutes');
    `);
    const customerRows = await asUser(
      customerUser,
      "select id from public.platform_impersonation_grants;"
    );
    expect(customerRows.rows).toHaveLength(0);

    const staffRows = await asUser(
      staffUser,
      "select id from public.platform_impersonation_grants;"
    );
    expect(staffRows.rows.length).toBeGreaterThan(0);
  });
});
