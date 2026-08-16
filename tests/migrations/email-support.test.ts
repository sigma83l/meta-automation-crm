import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Exercises the email and support schema against a real PostgreSQL engine.
 *
 * What matters here is what the schema refuses. The email tables were designed
 * so that a recovery token has nowhere to live, the correlation token is
 * withheld from the browser by a column grant rather than a policy, and a
 * ticket thread cannot be crossed between tenants. None of that is visible to
 * TypeScript.
 */

const migrationPath = fileURLToPath(
  new URL("../../supabase/migrations/20260816140000_email_support.sql", import.meta.url)
);
const preludePath = fileURLToPath(new URL("./prelude.sql", import.meta.url));

let db: PGlite;
let workspaceId: string;
let ticketId: string;

async function newWorkspace(name: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into public.workspaces (name) values ($1) returning id",
    [name]
  );
  return result.rows[0]!.id;
}

async function newTicket(workspace: string, token: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into public.support_tickets (workspace_id, subject, correlation_token)
     values ($1, 'Cannot connect WhatsApp', $2) returning id`,
    [workspace, token]
  );
  return result.rows[0]!.id;
}

async function recordEmail(
  options: {
    workspace?: string | null;
    category?: string;
    stream?: string;
    key?: string;
    variableNames?: string[];
  } = {}
) {
  await db.query(
    `insert into public.email_events
       (workspace_id, category, stream, template_id, recipient_domain, variable_names,
        idempotency_key)
     values ($1, $2, $3, 'tpl-1', 'example.com', $4, $5)`,
    [
      options.workspace === undefined ? workspaceId : options.workspace,
      options.category ?? "workspace_notification",
      options.stream ?? "transactional",
      options.variableNames ?? [],
      options.key ?? `key-${Math.random()}`
    ]
  );
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(readFileSync(preludePath, "utf8"));
  await db.exec(readFileSync(migrationPath, "utf8"));
  workspaceId = await newWorkspace("acme");
  ticketId = await newTicket(workspaceId, "correlation-token-0123456789");
});

afterAll(async () => {
  await db?.close();
});

describe("a recovery token has nowhere to live", () => {
  it("stores variable names, not values", async () => {
    await recordEmail({
      category: "auth_recovery",
      key: "recovery:1",
      variableNames: ["first_name", "recovery_url"]
    });
    const result = await db.query<{ variable_names: string[] }>(
      "select variable_names from public.email_events where idempotency_key = 'recovery:1'"
    );
    expect(result.rows[0]!.variable_names).toEqual(["first_name", "recovery_url"]);
  });

  it("has no column that could hold a rendered body or a token", async () => {
    // A token in a database row is readable by everybody with database access,
    // which is far wider than the one mailbox it was addressed to.
    const result = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'email_events'`
    );
    const columns = result.rows.map((row) => row.column_name);
    for (const forbidden of ["body", "html", "text", "token", "variables", "recipient"]) {
      expect(`${forbidden}:${columns.includes(forbidden)}`).toBe(`${forbidden}:false`);
    }
  });

  it("records the recipient domain rather than the address", async () => {
    const result = await db.query<{ recipient_domain: string }>(
      "select recipient_domain from public.email_events where idempotency_key = 'recovery:1'"
    );
    expect(result.rows[0]!.recipient_domain).toBe("example.com");
  });
});

describe("a durable event exists before the provider is called", () => {
  it("defaults to pending rather than sent", async () => {
    // The row is written first; the UI never waits on the provider.
    await recordEmail({ key: "pending:1" });
    const result = await db.query<{ status: string; provider: string | null }>(
      "select status, provider from public.email_events where idempotency_key = 'pending:1'"
    );
    expect(result.rows[0]!.status).toBe("pending");
    expect(result.rows[0]!.provider).toBeNull();
  });

  it("refuses a duplicate idempotency key, so a retry cannot double-send", async () => {
    await recordEmail({ key: "once:1" });
    await expect(recordEmail({ key: "once:1" })).rejects.toThrow(/duplicate key/i);
  });

  it("allows a workspaceless recovery email", async () => {
    // Somebody recovering an account often cannot reach any workspace, which is
    // usually why they are recovering.
    await expect(
      recordEmail({ workspace: null, category: "auth_recovery", key: "recovery:2" })
    ).resolves.toBeUndefined();
  });

  it("refuses an unknown category or stream", async () => {
    await expect(recordEmail({ category: "newsletter_blast" })).rejects.toThrow(/category/);
    await expect(recordEmail({ stream: "promotional" })).rejects.toThrow(/stream/);
  });
});

describe("the correlation token is withheld from the browser", () => {
  it("is not selectable by authenticated", async () => {
    // A bearer credential for a ticket thread. A column grant rather than a
    // policy, because policies filter rows and this is a column.
    const result = await db.query<{ count: string }>(
      `select count(*) as count from information_schema.column_privileges
        where table_name = 'support_tickets' and column_name = 'correlation_token'
          and grantee = 'authenticated' and privilege_type = 'SELECT'`
    );
    expect(Number(result.rows[0]!.count)).toBe(0);
  });

  it("is still readable by service_role, which needs it to correlate", async () => {
    const result = await db.query<{ correlation_token: string }>(
      "select correlation_token from public.support_tickets where id = $1",
      [ticketId]
    );
    expect(result.rows[0]!.correlation_token).toBe("correlation-token-0123456789");
  });

  it("refuses a token short enough to guess", async () => {
    await expect(newTicket(workspaceId, "short")).rejects.toThrow(/correlation_token/);
  });

  it("refuses a token already used by another ticket", async () => {
    await expect(newTicket(workspaceId, "correlation-token-0123456789")).rejects.toThrow(
      /duplicate key/i
    );
  });
});

describe("ticket threads cannot cross tenants", () => {
  it("refuses a message attached to another workspace's ticket", async () => {
    const other = await newWorkspace("rival");
    await expect(
      db.query(
        `insert into public.support_ticket_messages (workspace_id, ticket_id, author_kind, body)
         values ($1, $2, 'customer', 'let me read that')`,
        [other, ticketId]
      )
    ).rejects.toThrow(/foreign key/i);
  });

  it("records an unverified inbound message without treating it as the owner", async () => {
    // 'none' exists so a message can be kept for review while never counting as
    // the ticket owner speaking.
    await db.query(
      `insert into public.support_ticket_messages
         (workspace_id, ticket_id, author_kind, body, correlation_method)
       values ($1, $2, 'customer', 'is this you?', 'none')`,
      [workspaceId, ticketId]
    );
    const result = await db.query<{ correlation_method: string }>(
      `select correlation_method from public.support_ticket_messages
        where ticket_id = $1 order by created_at desc limit 1`,
      [ticketId]
    );
    expect(result.rows[0]!.correlation_method).toBe("none");
  });

  it("refuses an unknown correlation method", async () => {
    await expect(
      db.query(
        `insert into public.support_ticket_messages
           (workspace_id, ticket_id, author_kind, body, correlation_method)
         values ($1, $2, 'customer', 'trust me', 'from_header')`,
        [workspaceId, ticketId]
      )
    ).rejects.toThrow(/correlation_method/);
  });
});

describe("consent belongs to the person, not the workspace", () => {
  it("is keyed by user and unique per user", async () => {
    const result = await db.query<{ id: string }>(
      "insert into auth.users (email) values ('owner@example.com') returning id"
    );
    const userId = result.rows[0]!.id;
    await db.query("insert into public.email_consents (user_id) values ($1)", [userId]);
    await expect(
      db.query("insert into public.email_consents (user_id) values ($1)", [userId])
    ).rejects.toThrow(/duplicate key/i);
  });

  it("defaults to no marketing consent", async () => {
    const result = await db.query<{ marketing_consent: boolean }>(
      "select marketing_consent from public.email_consents limit 1"
    );
    expect(result.rows[0]!.marketing_consent).toBe(false);
  });

  it("lets a user update their own consent without a support request", async () => {
    // An unsubscribe that needs a support request is not an unsubscribe.
    const result = await db.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_name = 'email_consents' and grantee = 'authenticated'`
    );
    expect(result.rows.map((row) => row.privilege_type).sort()).toEqual(["SELECT", "UPDATE"]);
  });

  it("is separate from customer_consents, which governs a different thing", async () => {
    // Conflating them would mean a workspace unsubscribing from our product
    // emails silently stopped their own customers' replies.
    const result = await db.query<{ count: string }>(
      `select count(*) as count from information_schema.columns
        where table_name = 'email_consents' and column_name = 'customer_id'`
    );
    expect(Number(result.rows[0]!.count)).toBe(0);
  });
});

describe("tenant isolation", () => {
  it("forces row level security on every table", async () => {
    const result = await db.query<{ relname: string; ok: boolean }>(
      `select c.relname, (c.relrowsecurity and c.relforcerowsecurity) as ok
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('email_events', 'email_consents', 'support_tickets',
                            'support_ticket_messages')`
    );
    expect(result.rows.length).toBe(4);
    for (const row of result.rows) expect(`${row.relname}:${row.ok}`).toBe(`${row.relname}:true`);
  });

  it("never lets a member write a ticket directly", async () => {
    // Column grants do not appear in role_table_grants, so the table-level view
    // is legitimately empty here; column_privileges is where they live.
    const tableLevel = await db.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_name = 'support_tickets' and grantee = 'authenticated'`
    );
    expect(tableLevel.rows).toEqual([]);

    const columnLevel = await db.query<{ privilege_type: string }>(
      `select distinct privilege_type from information_schema.column_privileges
        where table_name = 'support_tickets' and grantee = 'authenticated'`
    );
    expect(columnLevel.rows.map((row) => row.privilege_type)).toEqual(["SELECT"]);
  });

  it("still exposes the columns a member legitimately needs", async () => {
    // The point is to withhold one column, not to make the table unreadable.
    const result = await db.query<{ column_name: string }>(
      `select column_name from information_schema.column_privileges
        where table_name = 'support_tickets' and grantee = 'authenticated'
          and privilege_type = 'SELECT'`
    );
    const readable = result.rows.map((row) => row.column_name);
    for (const column of ["id", "subject", "status", "priority", "created_at"]) {
      expect(`${column}:${readable.includes(column)}`).toBe(`${column}:true`);
    }
  });
});
