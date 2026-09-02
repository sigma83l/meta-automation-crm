import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Answering a suggestion, as the database sees it.
 *
 * `crm_next_action_projection` grants `authenticated` select and nothing else,
 * so the only way a person settles a proposal is through this function - and
 * because it runs with definer rights, every check it makes is the only check
 * there is. That is what these assert: that authority is re-derived from the
 * caller rather than assumed, that the opening is two columns wide, and that a
 * settled row cannot be answered twice.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const platformStub = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const CUSTOMER = "cccccccc-0000-0000-0000-000000000001";

const ROLES = ["owner", "admin", "operator", "viewer"] as const;
type Role = (typeof ROLES)[number];
const userFor: Record<Role, string> = {
  owner: "aaaaaaaa-0000-0000-0000-000000000001",
  admin: "aaaaaaaa-0000-0000-0000-000000000002",
  operator: "aaaaaaaa-0000-0000-0000-000000000003",
  viewer: "aaaaaaaa-0000-0000-0000-000000000004"
};

let db: PGlite;

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

  await db.exec(`set session_replication_role = replica;`);
  await db.exec(`
    insert into public.workspaces (id, name, status) values
      ('${WORKSPACE}', 'Acme', 'active'), ('${OTHER}', 'Other', 'active');
  `);
  for (const role of ROLES) {
    await db.exec(`
      insert into auth.users (id, email) values ('${userFor[role]}', '${role}@example.test');
      insert into public.workspace_memberships (workspace_id, user_id, role, status)
      values ('${WORKSPACE}', '${userFor[role]}', '${role}', 'active');
      insert into public.profiles (id, workspace_id, status)
      values ('${userFor[role]}', '${WORKSPACE}', 'active');
    `);
  }
  await db.exec(`
    insert into public.customers (id, workspace_id, display_name, created_by)
    values ('${CUSTOMER}', '${WORKSPACE}', 'Probe', '${userFor.owner}');
  `);
  await db.exec(`set session_replication_role = origin;`);
});

afterAll(async () => {
  await db?.close();
});

/** Inserts an open proposal the way an engine does, and returns its id. */
async function openProposal(): Promise<string> {
  const result = await db.query<{ id: string }>(`
    insert into public.crm_next_action_projection
      (workspace_id, customer_id, action_type, owner_type, owner_id, source, confidence)
    values ('${WORKSPACE}', '${CUSTOMER}', 'reply', 'human', '${userFor.owner}', 'ai', 0.8)
    returning id;
  `);
  return result.rows[0]!.id;
}

/** Calls the function as a signed-in person, and reports what happened. */
async function settleAs(uid: string | null, proposalId: string, outcome: string) {
  await db.exec(`select set_config('test.uid', ${uid ? `'${uid}'` : "''"}, false);`);
  await db.exec("begin;");
  try {
    await db.exec(`set local role ${uid ? "authenticated" : "anon"};`);
    await db.query(
      `select * from public.settle_next_action('${WORKSPACE}', '${proposalId}', '${outcome}');`
    );
    return "settled";
  } catch (error) {
    return String(error);
  } finally {
    await db.exec("rollback;");
  }
}

describe("who may answer a suggestion", () => {
  it.each(["owner", "admin", "operator"] as const)("admits %s", async (role) => {
    expect(await settleAs(userFor[role], await openProposal(), "accepted")).toBe("settled");
  });

  it("refuses a viewer", async () => {
    // The application asserts this too. The assertion here is that the refusal
    // survives a caller that skipped the application, which is the only version
    // of it that is a guarantee.
    expect(await settleAs(userFor.viewer, await openProposal(), "accepted")).toMatch(
      /not permitted/
    );
  });

  it("refuses a signed-out caller", async () => {
    expect(await settleAs(null, await openProposal(), "accepted")).toMatch(/not permitted|denied/i);
  });

  it("refuses a member of another workspace", async () => {
    await db.exec(`set session_replication_role = replica;`);
    await db.exec(`
      insert into auth.users (id, email)
      values ('aaaaaaaa-0000-0000-0000-000000000009', 'outsider@example.test');
      insert into public.workspace_memberships (workspace_id, user_id, role, status)
      values ('${OTHER}', 'aaaaaaaa-0000-0000-0000-000000000009', 'owner', 'active');
      insert into public.profiles (id, workspace_id, status)
      values ('aaaaaaaa-0000-0000-0000-000000000009', '${OTHER}', 'active');
    `);
    await db.exec(`set session_replication_role = origin;`);
    expect(
      await settleAs("aaaaaaaa-0000-0000-0000-000000000009", await openProposal(), "accepted")
    ).toMatch(/not permitted/);
  });
});

describe("what may be said", () => {
  it("accepts the two answers a person can give", async () => {
    for (const outcome of ["accepted", "rejected"]) {
      expect(await settleAs(userFor.operator, await openProposal(), outcome)).toBe("settled");
    }
  });

  it("refuses superseded, which is the engine's word and not a person's", async () => {
    expect(await settleAs(userFor.operator, await openProposal(), "superseded")).toMatch(
      /accepted or rejected/
    );
  });
});

describe("settling once", () => {
  it("refuses a second answer", async () => {
    const id = await openProposal();
    await db.exec(`select set_config('test.uid', '${userFor.operator}', false);`);
    await db.exec(`set role authenticated;`);
    await db.query(`select * from public.settle_next_action('${WORKSPACE}', '${id}', 'accepted');`);
    await db.exec(`reset role;`);
    // Re-answering would rewrite a decision somebody already made, and the
    // record would show only the second one.
    expect(await settleAs(userFor.operator, id, "rejected")).toMatch(/no open proposal/);
  });

  it("changes the two settlement columns and nothing else", async () => {
    const id = await openProposal();
    const before = await db.query<Record<string, unknown>>(
      `select * from public.crm_next_action_projection where id = '${id}';`
    );
    await db.exec(`select set_config('test.uid', '${userFor.operator}', false);`);
    await db.exec(`set role authenticated;`);
    await db.query(`select * from public.settle_next_action('${WORKSPACE}', '${id}', 'rejected');`);
    await db.exec(`reset role;`);
    const after = await db.query<Record<string, unknown>>(
      `select * from public.crm_next_action_projection where id = '${id}';`
    );

    const changed = Object.keys(before.rows[0]!).filter(
      (column) => String(before.rows[0]![column]) !== String(after.rows[0]![column])
    );
    expect(changed.sort()).toEqual(["settled_at", "settled_outcome"]);
  });

  it("leaves the settled row in place", async () => {
    // A rejected suggestion that disappeared would take the evidence of a bad
    // suggestion pattern with it.
    const id = await openProposal();
    await db.exec(`select set_config('test.uid', '${userFor.operator}', false);`);
    await db.exec(`set role authenticated;`);
    await db.query(`select * from public.settle_next_action('${WORKSPACE}', '${id}', 'rejected');`);
    await db.exec(`reset role;`);
    const rows = await db.query(
      `select settled_outcome from public.crm_next_action_projection where id = '${id}';`
    );
    expect(rows.rows).toHaveLength(1);
  });
});

describe("the table itself stays closed", () => {
  it("still refuses a direct update from a session, whatever the role", async () => {
    // The function is the opening. If the grant were widened instead, an
    // operator could change an action's type, its confidence or its source -
    // including to 'derived', which the table permits and only TypeScript
    // refuses.
    const id = await openProposal();
    await db.exec(`select set_config('test.uid', '${userFor.owner}', false);`);
    await db.exec("begin;");
    try {
      await db.exec(`set local role authenticated;`);
      await expect(
        db.query(
          `update public.crm_next_action_projection set source = 'derived' where id = '${id}';`
        )
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec("rollback;");
    }
  });
});
