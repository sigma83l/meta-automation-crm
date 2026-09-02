import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import matrix from "@/tests/golden/rbac-matrix.json";

/**
 * The pack's RBAC matrix, executed rather than reasoned about.
 *
 * Five roles × three contexts × seven CRM mutations, every cell attempted as a
 * real browser session against a real engine. `role-policies.test.ts` proves
 * the two authority functions answer correctly; this proves the answer is
 * actually what stops a write, which is a different claim - a table whose
 * policy is right and whose grants are wrong passes the first and fails here.
 *
 * The matrix's own rule is that viewer, anonymous, forged and cross-workspace
 * writes must all fail. Owner/Admin/Operator capability follows AGENTS: viewer
 * is read-only, operator may change CRM, owner and admin alone may change
 * business settings.
 *
 * Three of the seven mutations are refused for *every* role, and that is the
 * design rather than a gap. `contact_facts`, `crm_score_snapshots` and
 * `tasks_followups` grant `authenticated` nothing but select: they are written
 * by engines through service role, behind an explicit resolved workspace and
 * role check. So the denial there is the absence of a grant, which is stronger
 * than a policy - a mistake in a predicate cannot open it. The expectation
 * table records which kind of refusal each cell is, so a later migration that
 * hands out an insert grant and covers it with a policy shows up here as a
 * changed answer rather than as a still-passing test.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const platformStub = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

const OWN = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const OWN_CUSTOMER = "cccccccc-0000-0000-0000-000000000001";
const OTHER_CUSTOMER = "cccccccc-0000-0000-0000-000000000002";

/**
 * The vocabulary, stated here and checked against the pack below.
 *
 * Read straight off the JSON these would each widen to `string`, and every
 * lookup in the tables that follow would accept a key the matrix never names -
 * so a typo would read as an untested cell rather than as a failure.
 */
const ROLES = ["owner", "admin", "operator", "viewer", "anonymous"] as const;
const CONTEXTS = ["own_workspace", "forged_workspace", "other_workspace"] as const;
const MUTATIONS = [
  "edit_contact",
  "edit_fact",
  "override_score",
  "create_followup",
  "change_status",
  "import",
  "export"
] as const;

type Role = (typeof ROLES)[number];
type Context = (typeof CONTEXTS)[number];
type Mutation = (typeof MUTATIONS)[number];

const userFor: Record<Exclude<Role, "anonymous">, string> = {
  owner: "aaaaaaaa-0000-0000-0000-000000000001",
  admin: "aaaaaaaa-0000-0000-0000-000000000002",
  operator: "aaaaaaaa-0000-0000-0000-000000000003",
  viewer: "aaaaaaaa-0000-0000-0000-000000000004"
};

/**
 * How a cell is expected to end.
 *
 * `allowed` and `denied` are the matrix's own vocabulary. `ungranted` is a
 * denial too - it is reported separately because it says the write was refused
 * before any policy was consulted, and losing that distinction would hide a
 * table quietly moving from "no browser session may write this" to "a correct
 * predicate is the only thing stopping them".
 */
type Verdict = "allowed" | "denied" | "ungranted";

/**
 * The SQL each mutation is, per context.
 *
 * `own_workspace` acts on the caller's own rows. `forged_workspace` stamps a
 * write with a workspace the caller does not belong to - the browser-supplied
 * workspace id AGENTS calls a hint and never authority. `other_workspace`
 * reaches for rows that already belong to somebody else.
 */
const statements: Record<Mutation, Record<Context, string>> = {
  edit_contact: {
    own_workspace: `update public.customers set display_name = 'Edited' where id = '${OWN_CUSTOMER}'`,
    forged_workspace: `update public.customers set workspace_id = '${OTHER}' where id = '${OWN_CUSTOMER}'`,
    other_workspace: `update public.customers set display_name = 'Edited' where id = '${OTHER_CUSTOMER}'`
  },
  edit_fact: {
    own_workspace: `insert into public.contact_facts (workspace_id, customer_id, fact_key, fact_value, source_ref) values ('${OWN}', '${OWN_CUSTOMER}', 'current_need', 'A quote', 'msg-1')`,
    forged_workspace: `insert into public.contact_facts (workspace_id, customer_id, fact_key, fact_value, source_ref) values ('${OTHER}', '${OTHER_CUSTOMER}', 'current_need', 'A quote', 'msg-1')`,
    other_workspace: `update public.contact_facts set fact_value = 'Edited' where workspace_id = '${OTHER}'`
  },
  override_score: {
    own_workspace: `insert into public.crm_score_snapshots (workspace_id, customer_id, score, components, confidence, config_version) values ('${OWN}', '${OWN_CUSTOMER}', 90, '{}'::jsonb, 0.5, 'v1')`,
    forged_workspace: `insert into public.crm_score_snapshots (workspace_id, customer_id, score, components, confidence, config_version) values ('${OTHER}', '${OTHER_CUSTOMER}', 90, '{}'::jsonb, 0.5, 'v1')`,
    other_workspace: `update public.crm_score_snapshots set score = 10 where workspace_id = '${OTHER}'`
  },
  create_followup: {
    own_workspace: `insert into public.tasks_followups (workspace_id, customer_id, stop_reason, objective, cancel_condition, due_at) values ('${OWN}', '${OWN_CUSTOMER}', 'price_sent', 'Follow up', 'They reply', now() + interval '1 day')`,
    forged_workspace: `insert into public.tasks_followups (workspace_id, customer_id, stop_reason, objective, cancel_condition, due_at) values ('${OTHER}', '${OTHER_CUSTOMER}', 'price_sent', 'Follow up', 'They reply', now() + interval '1 day')`,
    other_workspace: `update public.tasks_followups set objective = 'Edited' where workspace_id = '${OTHER}'`
  },
  change_status: {
    own_workspace: `update public.customers set lead_status = 'needs_reply' where id = '${OWN_CUSTOMER}'`,
    forged_workspace: `insert into public.customers (workspace_id, display_name, created_by, lead_status) values ('${OTHER}', 'Forged', '${userFor.owner}', 'needs_reply')`,
    other_workspace: `update public.customers set lead_status = 'needs_reply' where id = '${OTHER_CUSTOMER}'`
  },
  import: {
    own_workspace: `insert into public.customers (workspace_id, display_name, created_by, source) values ('${OWN}', 'Imported', '${userFor.owner}', 'import')`,
    forged_workspace: `insert into public.customers (workspace_id, display_name, created_by, source) values ('${OTHER}', 'Imported', '${userFor.owner}', 'import')`,
    other_workspace: `update public.customers set source = 'import' where id = '${OTHER_CUSTOMER}'`
  },
  export: {
    own_workspace: `insert into public.export_jobs (workspace_id, requested_by, scope) values ('${OWN}', '${userFor.owner}', 'workspace')`,
    forged_workspace: `insert into public.export_jobs (workspace_id, requested_by, scope) values ('${OTHER}', '${userFor.owner}', 'workspace')`,
    other_workspace: `update public.export_jobs set status = 'ready' where workspace_id = '${OTHER}'`
  }
};

/**
 * What every cell must do.
 *
 * Written out per mutation rather than derived from a rule, because a table
 * that computes the expectation from the same idea the policy encodes agrees
 * with the schema by construction and proves nothing.
 */
const OPERATOR_TABLE: Record<Role, Verdict> = {
  owner: "allowed",
  admin: "allowed",
  operator: "allowed",
  viewer: "denied",
  // Not merely policy-refused. `anon` has every privilege revoked on all of
  // these tables, so a signed-out request is stopped by the grant before a
  // predicate is reached - which is why the viewer row and this one differ.
  anonymous: "ungranted"
};

const SERVICE_ROLE_ONLY: Record<Role, Verdict> = {
  owner: "ungranted",
  admin: "ungranted",
  operator: "ungranted",
  viewer: "ungranted",
  anonymous: "ungranted"
};

const expected: Record<Mutation, Record<Context, Record<Role, Verdict>>> = {
  edit_contact: {
    own_workspace: OPERATOR_TABLE,
    forged_workspace: { ...OPERATOR_TABLE, owner: "denied", admin: "denied", operator: "denied" },
    other_workspace: { ...OPERATOR_TABLE, owner: "denied", admin: "denied", operator: "denied" }
  },
  edit_fact: {
    own_workspace: SERVICE_ROLE_ONLY,
    forged_workspace: SERVICE_ROLE_ONLY,
    other_workspace: SERVICE_ROLE_ONLY
  },
  override_score: {
    own_workspace: SERVICE_ROLE_ONLY,
    forged_workspace: SERVICE_ROLE_ONLY,
    other_workspace: SERVICE_ROLE_ONLY
  },
  create_followup: {
    own_workspace: SERVICE_ROLE_ONLY,
    forged_workspace: SERVICE_ROLE_ONLY,
    other_workspace: SERVICE_ROLE_ONLY
  },
  change_status: {
    own_workspace: OPERATOR_TABLE,
    forged_workspace: { ...OPERATOR_TABLE, owner: "denied", admin: "denied", operator: "denied" },
    other_workspace: { ...OPERATOR_TABLE, owner: "denied", admin: "denied", operator: "denied" }
  },
  import: {
    own_workspace: OPERATOR_TABLE,
    forged_workspace: { ...OPERATOR_TABLE, owner: "denied", admin: "denied", operator: "denied" },
    other_workspace: { ...OPERATOR_TABLE, owner: "denied", admin: "denied", operator: "denied" }
  },
  export: {
    own_workspace: OPERATOR_TABLE,
    forged_workspace: { ...OPERATOR_TABLE, owner: "denied", admin: "denied", operator: "denied" },
    other_workspace: { ...OPERATOR_TABLE, owner: "denied", admin: "denied", operator: "denied" }
  }
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

  // Triggers suppressed: handle_new_user provisions a whole workspace per user,
  // which would fight the fixed memberships this matrix depends on.
  await db.exec(`set session_replication_role = replica;`);
  await db.exec(`
    insert into public.workspaces (id, name, status) values
      ('${OWN}', 'Acme', 'active'), ('${OTHER}', 'Other', 'active');
  `);
  for (const [role, id] of Object.entries(userFor)) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${role}@example.test');
      insert into public.workspace_memberships (workspace_id, user_id, role, status)
      values ('${OWN}', '${id}', '${role}', 'active');
      insert into public.profiles (id, workspace_id, status)
      values ('${id}', '${OWN}', 'active');
    `);
  }
  await db.exec(`
    insert into public.customers (id, workspace_id, display_name, created_by) values
      ('${OWN_CUSTOMER}', '${OWN}', 'Own contact', '${userFor.owner}'),
      ('${OTHER_CUSTOMER}', '${OTHER}', 'Other contact', '${userFor.owner}');
    insert into public.contact_facts (workspace_id, customer_id, fact_key, fact_value, source_ref)
    values ('${OTHER}', '${OTHER_CUSTOMER}', 'current_need', 'Theirs', 'msg-0');
    insert into public.crm_score_snapshots
      (workspace_id, customer_id, score, components, confidence, config_version)
    values ('${OTHER}', '${OTHER_CUSTOMER}', 50, '{}'::jsonb, 0.5, 'v1');
    insert into public.tasks_followups
      (workspace_id, customer_id, stop_reason, objective, cancel_condition, due_at)
    values ('${OTHER}', '${OTHER_CUSTOMER}', 'price_sent', 'Theirs', 'They reply', now());
    insert into public.export_jobs (workspace_id, requested_by, scope)
    values ('${OTHER}', '${userFor.owner}', 'workspace');
  `);
  await db.exec(`set session_replication_role = origin;`);
});

afterAll(async () => {
  await db?.close();
});

/**
 * Runs one cell the way a browser runs it, and reports how it ended.
 *
 * The `set role` is the load-bearing half: PGlite connects as a superuser, and
 * a superuser bypasses row security entirely, so a version of this that only
 * set `test.uid` would report every cell as allowed no matter what the schema
 * said. Anonymous gets the `anon` role and no uid, which is what a signed-out
 * request actually is.
 *
 * Everything runs inside a transaction that is always rolled back, so an
 * allowed write in one cell cannot change what a later cell finds.
 */
async function attempt(role: Role, sql: string): Promise<Verdict> {
  const uid = role === "anonymous" ? "" : userFor[role];
  await db.exec(`select set_config('test.uid', '${uid}', false);`);
  await db.exec("begin;");
  try {
    await db.exec(`set local role ${role === "anonymous" ? "anon" : "authenticated"};`);
    const result = await db.query(`${sql} returning id;`);
    // An update matching no row is not permission: RLS filters the `using`
    // clause silently, so a refused update reports success over zero rows.
    return result.rows.length > 0 ? "allowed" : "denied";
  } catch (error) {
    const message = String(error);
    // "permission denied for table" is the grant refusing before any policy is
    // consulted; a policy violation names the row security check it failed.
    if (/permission denied for table/i.test(message)) return "ungranted";
    if (/row-level security policy/i.test(message)) return "denied";
    // Anything else is this file's own bug, and must say so. Reading every
    // failure as a denial is how a statement with a typo in it, or one that
    // violates a check constraint, passes as proof that permission was
    // withheld - which is the one conclusion it cannot support.
    throw error;
  } finally {
    await db.exec("rollback;");
  }
}

describe("the matrix covers what the pack declares", () => {
  it("names every role, context and mutation the pack does", () => {
    // Guards the enumeration itself. A mutation added to the pack's matrix with
    // no statement and no expectation would otherwise simply not be tested,
    // and the suite would stay green while a cell went unproven.
    expect([...ROLES].sort()).toEqual([...matrix.roles].sort());
    expect([...CONTEXTS].sort()).toEqual([...matrix.contexts].sort());
    expect([...MUTATIONS].sort()).toEqual([...matrix.mutations].sort());
  });

  it("has a statement and an expectation for all 105 cells", () => {
    let cells = 0;
    for (const mutation of MUTATIONS) {
      for (const context of CONTEXTS) {
        expect(statements[mutation][context]).toBeTruthy();
        for (const role of ROLES) {
          expect(expected[mutation][context][role]).toBeTruthy();
          cells += 1;
        }
      }
    }
    expect(cells).toBe(ROLES.length * CONTEXTS.length * MUTATIONS.length);
  });
});

for (const mutation of MUTATIONS) {
  describe(mutation, () => {
    for (const context of CONTEXTS) {
      for (const role of ROLES) {
        const want = expected[mutation][context][role];
        it(`${context}: ${role} is ${want}`, async () => {
          expect(await attempt(role, statements[mutation][context])).toBe(want);
        });
      }
    }
  });
}

describe("the rule the matrix states outright", () => {
  it("lets no viewer, anonymous, forged or cross-workspace write through", () => {
    // The pack's one unconditional sentence, asserted against the expectation
    // table rather than against the database - so a future edit that relaxes a
    // cell has to fail here before it can be run and found to pass.
    for (const mutation of MUTATIONS) {
      for (const context of CONTEXTS) {
        for (const role of ROLES) {
          const forbidden =
            role === "viewer" || role === "anonymous" || context !== "own_workspace";
          if (forbidden) expect(expected[mutation][context][role]).not.toBe("allowed");
        }
      }
    }
  });
});
