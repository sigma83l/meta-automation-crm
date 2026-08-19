import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The inbound projection, executed rather than read.
 *
 * This is the step that had never existed: nothing in the repository wrote
 * `conversations` or `messages`, so a verified message reached the database and
 * stopped. The properties worth executing are the ones a handler cannot be
 * trusted to preserve on its own — that a replay converges instead of
 * duplicating, that a concurrent first message from one customer produces one
 * customer rather than two, and that a receipt updates rather than creates.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const platformStub = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

let db: PGlite;

async function workspaceWithConnection(account: string): Promise<string> {
  const workspace = await db.query<{ id: string }>(
    "insert into public.workspaces (name, status) values ($1, 'active') returning id",
    [`ws-${account}`]
  );
  const workspaceId = workspace.rows[0]!.id;
  await db.query(
    `insert into public.meta_connections
       (workspace_id, channel, mode, status, provider_account_id, display_name)
     values ($1, 'whatsapp', 'sandbox', 'active', $2, 'probe')`,
    [workspaceId, account]
  );
  return workspaceId;
}

async function ingest(
  account: string,
  eventId: string,
  overrides: Partial<{
    eventType: string;
    senderRef: string | null;
    messageRef: string | null;
    summary: string | null;
    body: string | null;
    statusMetadata: string;
  }> = {}
) {
  const row = await db.query<{ webhook_event_id: string | null; trusted_workspace_id: string }>(
    `select * from public.ingest_meta_event(
       'whatsapp', $1, $2, $3, $4, $5, $6, '[]'::jsonb, $7::jsonb, now(), $8
     )`,
    [
      account,
      eventId,
      overrides.eventType ?? "message",
      overrides.senderRef === undefined ? "905551112233" : overrides.senderRef,
      overrides.messageRef === undefined ? `wamid.${eventId}` : overrides.messageRef,
      overrides.summary === undefined ? "hello" : overrides.summary,
      overrides.statusMetadata ?? "{}",
      overrides.body === undefined ? "hello" : overrides.body
    ]
  );
  return row.rows[0]!;
}

async function project(webhookEventId: string, workspaceId: string) {
  const row = await db.query<{
    result: string;
    customer_id: string | null;
    conversation_id: string | null;
    message_id: string | null;
  }>("select * from public.project_meta_message($1, $2)", [webhookEventId, workspaceId]);
  return row.rows[0]!;
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
  // Workspace inserts fire the provisioning trigger; suppressed because this
  // suite is about projection, not billing.
  await db.exec(`set session_replication_role = replica;`);
});

afterAll(async () => {
  await db?.close();
});

describe("projecting an inbound message", () => {
  it("creates the customer, identity, conversation and message", async () => {
    const workspaceId = await workspaceWithConnection("wa-project");
    const event = await ingest("wa-project", "e.project.1");
    const result = await project(event.webhook_event_id!, workspaceId);

    expect(result.result).toBe("projected");

    const message = await db.query<{ body: string; direction: string; status: string }>(
      "select body, direction, status from public.messages where id = $1",
      [result.message_id]
    );
    expect(message.rows[0]).toEqual({ body: "hello", direction: "inbound", status: "received" });

    const customer = await db.query<{ display_name: string; source: string; created_by: null }>(
      "select display_name, source, created_by from public.customers where id = $1",
      [result.customer_id]
    );
    // The identifier stands in as the name, and nobody is recorded as having
    // created a customer who created themselves.
    expect(customer.rows[0]).toEqual({
      display_name: "905551112233",
      source: "inbound_whatsapp",
      created_by: null
    });

    const conversation = await db.query<{ unread_count: number; owner: string; state: string }>(
      "select unread_count, owner, state from public.conversations where id = $1",
      [result.conversation_id]
    );
    expect(conversation.rows[0]).toEqual({ unread_count: 1, owner: "automation", state: "open" });
  });

  it("keeps the whole body, not the 500-character preview", async () => {
    const workspaceId = await workspaceWithConnection("wa-long");
    const long = "x".repeat(2000);
    const event = await ingest("wa-long", "e.long.1", { summary: long, body: long });
    const result = await project(event.webhook_event_id!, workspaceId);

    const message = await db.query<{ length: number }>(
      "select char_length(body) as length from public.messages where id = $1",
      [result.message_id]
    );
    expect(message.rows[0]!.length).toBe(2000);
  });

  it("converges on one row when the same event is projected twice", async () => {
    const workspaceId = await workspaceWithConnection("wa-replay");
    const event = await ingest("wa-replay", "e.replay.1");

    expect((await project(event.webhook_event_id!, workspaceId)).result).toBe("projected");
    const second = await project(event.webhook_event_id!, workspaceId);
    expect(second.result).toBe("duplicate");

    const counts = await db.query<{ messages: string; conversations: string }>(
      `select (select count(*)::text from public.messages where workspace_id = $1) as messages,
              (select count(*)::text from public.conversations where workspace_id = $1) as conversations`,
      [workspaceId]
    );
    // The unread count is the tell: a second increment would mean the
    // projection ran twice rather than returning early.
    expect(counts.rows[0]).toEqual({ messages: "1", conversations: "1" });
    const conversation = await db.query<{ unread_count: number }>(
      "select unread_count from public.conversations where workspace_id = $1",
      [workspaceId]
    );
    expect(conversation.rows[0]!.unread_count).toBe(1);
  });

  it("puts a second message from the same sender in the same conversation", async () => {
    const workspaceId = await workspaceWithConnection("wa-thread");
    const first = await ingest("wa-thread", "e.thread.1");
    const second = await ingest("wa-thread", "e.thread.2");

    const a = await project(first.webhook_event_id!, workspaceId);
    const b = await project(second.webhook_event_id!, workspaceId);

    expect(b.conversation_id).toBe(a.conversation_id);
    expect(b.customer_id).toBe(a.customer_id);
    expect(b.message_id).not.toBe(a.message_id);
  });

  it("deduplicates a message that arrived without a provider id", async () => {
    const workspaceId = await workspaceWithConnection("wa-noref");
    const event = await ingest("wa-noref", "e.noref.1", { messageRef: null });

    expect((await project(event.webhook_event_id!, workspaceId)).result).toBe("projected");
    expect((await project(event.webhook_event_id!, workspaceId)).result).toBe("duplicate");
  });
});

describe("events that are not a customer message", () => {
  it("applies a delivery receipt to the message it names", async () => {
    const workspaceId = await workspaceWithConnection("wa-receipt");
    const inbound = await ingest("wa-receipt", "e.receipt.1");
    const projected = await project(inbound.webhook_event_id!, workspaceId);

    const receipt = await ingest("wa-receipt", "e.receipt.2", {
      eventType: "message_status",
      messageRef: "wamid.e.receipt.1",
      statusMetadata: '{"status":"delivered"}'
    });
    const applied = await project(receipt.webhook_event_id!, workspaceId);

    expect(applied.result).toBe("status_applied");
    expect(applied.message_id).toBe(projected.message_id);

    const message = await db.query<{ status: string }>(
      "select status from public.messages where id = $1",
      [projected.message_id]
    );
    expect(message.rows[0]!.status).toBe("sent");
  });

  it("records a failed receipt as failed", async () => {
    const workspaceId = await workspaceWithConnection("wa-failed");
    const inbound = await ingest("wa-failed", "e.failed.1");
    const projected = await project(inbound.webhook_event_id!, workspaceId);

    const receipt = await ingest("wa-failed", "e.failed.2", {
      eventType: "message_status",
      messageRef: "wamid.e.failed.1",
      statusMetadata: '{"status":"failed"}'
    });
    await project(receipt.webhook_event_id!, workspaceId);

    const message = await db.query<{ status: string }>(
      "select status from public.messages where id = $1",
      [projected.message_id]
    );
    expect(message.rows[0]!.status).toBe("failed");
  });

  it("creates nothing for a receipt naming a message it has never seen", async () => {
    const workspaceId = await workspaceWithConnection("wa-orphan");
    const receipt = await ingest("wa-orphan", "e.orphan.1", {
      eventType: "message_status",
      messageRef: "wamid.never.seen",
      statusMetadata: '{"status":"read"}'
    });
    const applied = await project(receipt.webhook_event_id!, workspaceId);

    expect(applied.result).toBe("status_unmatched");
    const count = await db.query<{ count: string }>(
      "select count(*)::text as count from public.messages where workspace_id = $1",
      [workspaceId]
    );
    expect(count.rows[0]!.count).toBe("0");
  });

  it("skips a comment rather than folding it into a conversation", async () => {
    const workspaceId = await workspaceWithConnection("wa-comment");
    const event = await ingest("wa-comment", "e.comment.1", { eventType: "comment" });
    expect((await project(event.webhook_event_id!, workspaceId)).result).toBe("skipped");
  });

  it("refuses a message with no sender", async () => {
    const workspaceId = await workspaceWithConnection("wa-nosender");
    const event = await ingest("wa-nosender", "e.nosender.1", { senderRef: null });
    expect((await project(event.webhook_event_id!, workspaceId)).result).toBe("no_sender");
  });
});

describe("tenant safety", () => {
  it("returns nothing when the caller names the wrong workspace", async () => {
    const owning = await workspaceWithConnection("wa-owner");
    const other = await workspaceWithConnection("wa-other");
    const event = await ingest("wa-owner", "e.tenant.1");

    const wrong = await project(event.webhook_event_id!, other);
    expect(wrong.result).toBe("not_found");

    const count = await db.query<{ count: string }>(
      "select count(*)::text as count from public.messages where workspace_id = $1",
      [other]
    );
    expect(count.rows[0]!.count).toBe("0");
    expect((await project(event.webhook_event_id!, owning)).result).toBe("projected");
  });

  it("is not executable by a browser session", async () => {
    const rows = await db.query<{ has: boolean }>(
      `select has_function_privilege('authenticated', 'public.project_meta_message(uuid,uuid)', 'EXECUTE') as has`
    );
    expect(rows.rows[0]!.has).toBe(false);
  });
});
