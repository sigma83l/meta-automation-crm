import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Role enforcement at the database layer.
 *
 * Role authority is not only an application concern here: `can_manage_workspace`
 * and `can_operate_workspace` back real RLS policies, so a browser session
 * holding a viewer membership is refused by Postgres itself even if application
 * code were bypassed. That is the stronger half of the guarantee and nothing
 * exercised it.
 *
 * These run the real functions against a real engine rather than asserting on
 * the migration text, so a policy that parses but does not discriminate fails
 * here.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const platformStub = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

const ROLES = ["owner", "admin", "operator", "viewer"] as const;
type Role = (typeof ROLES)[number];

let db: PGlite;
const workspaceId = "11111111-1111-1111-1111-111111111111";
const userFor: Record<Role, string> = {
  owner: "aaaaaaaa-0000-0000-0000-000000000001",
  admin: "aaaaaaaa-0000-0000-0000-000000000002",
  operator: "aaaaaaaa-0000-0000-0000-000000000003",
  viewer: "aaaaaaaa-0000-0000-0000-000000000004"
};

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

  // Make the caller's identity settable so each role can be exercised as
  // itself. The stub returns null, which would make every check vacuously false.
  await db.exec(`
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid
    $$;
  `);

  // Seed with triggers suppressed: handle_new_user would provision a whole
  // workspace per user, which is provisioning behaviour tested elsewhere and
  // would fight the fixed memberships this test needs.
  await db.exec(`set session_replication_role = replica;`);
  await db.exec(`
    insert into public.workspaces (id, name, status)
    values ('${workspaceId}', 'Acme', 'active');
  `);
  for (const role of ROLES) {
    await db.exec(`
      insert into auth.users (id, email) values ('${userFor[role]}', '${role}@example.test');
      insert into public.workspace_memberships (workspace_id, user_id, role, status)
      values ('${workspaceId}', '${userFor[role]}', '${role}', 'active');
      -- is_active_member joins profiles as well: a membership without a
      -- matching active profile confers nothing, which is the same four-way
      -- join resolve_workspace performs.
      insert into public.profiles (id, workspace_id, status)
      values ('${userFor[role]}', '${workspaceId}', 'active');
    `);
  }
  await db.exec(`set session_replication_role = origin;`);
});

afterAll(async () => {
  await db?.close();
});

async function asUser<T>(userId: string, sql: string): Promise<T> {
  await db.exec(`select set_config('test.uid', '${userId}', false);`);
  const result = await db.query<{ value: T }>(sql);
  return result.rows[0]!.value;
}

describe("private.can_manage_workspace", () => {
  it.each(["owner", "admin"] as const)("admits %s", async (role) => {
    expect(
      await asUser<boolean>(
        userFor[role],
        `select private.can_manage_workspace('${workspaceId}') as value`
      )
    ).toBe(true);
  });

  it.each(["operator", "viewer"] as const)("refuses %s", async (role) => {
    expect(
      await asUser<boolean>(
        userFor[role],
        `select private.can_manage_workspace('${workspaceId}') as value`
      )
    ).toBe(false);
  });
});

describe("private.can_operate_workspace", () => {
  it.each(["owner", "admin", "operator"] as const)("admits %s", async (role) => {
    expect(
      await asUser<boolean>(
        userFor[role],
        `select private.can_operate_workspace('${workspaceId}') as value`
      )
    ).toBe(true);
  });

  it("refuses viewer", async () => {
    expect(
      await asUser<boolean>(
        userFor.viewer,
        `select private.can_operate_workspace('${workspaceId}') as value`
      )
    ).toBe(false);
  });
});

describe("tenant boundary", () => {
  it("grants no role authority over another workspace", async () => {
    // The invariant that matters most: role is scoped to a workspace, so an
    // owner of one tenant is nobody in another.
    const other = "22222222-2222-2222-2222-222222222222";
    await db.exec(
      `insert into public.workspaces (id, name, status) values ('${other}', 'Other', 'active');`
    );
    for (const role of ROLES) {
      expect(
        `${role}:${await asUser<boolean>(userFor[role], `select private.is_active_member('${other}') as value`)}`
      ).toBe(`${role}:false`);
      expect(
        `${role}:${await asUser<boolean>(userFor[role], `select private.can_manage_workspace('${other}') as value`)}`
      ).toBe(`${role}:false`);
    }
  });

  it("withdraws authority when the profile is disabled, not only the membership", async () => {
    // Two independent switches guard access; disabling either must be enough.
    await db.exec(`update public.profiles set status='disabled' where id='${userFor.owner}';`);
    expect(
      await asUser<boolean>(
        userFor.owner,
        `select private.can_manage_workspace('${workspaceId}') as value`
      )
    ).toBe(false);
    await db.exec(`update public.profiles set status='active' where id='${userFor.owner}';`);
  });

  it("withdraws authority when a membership is disabled", async () => {
    await db.exec(
      `update public.workspace_memberships set status='disabled' where user_id='${userFor.admin}';`
    );
    expect(
      await asUser<boolean>(
        userFor.admin,
        `select private.can_manage_workspace('${workspaceId}') as value`
      )
    ).toBe(false);
    await db.exec(
      `update public.workspace_memberships set status='active' where user_id='${userFor.admin}';`
    );
  });

  it("treats an anonymous caller as having no authority", async () => {
    await db.exec(`select set_config('test.uid', '', false);`);
    const result = await db.query<{ value: boolean }>(
      `select coalesce(private.can_manage_workspace('${workspaceId}'), false) as value`
    );
    expect(result.rows[0]!.value).toBe(false);
  });
});
