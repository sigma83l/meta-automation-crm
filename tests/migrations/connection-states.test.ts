import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Which connection states accept inbound, executed rather than asserted from
 * the migration text.
 *
 * ingest_meta_event admitted only 'active', so a connection marked degraded
 * would have silently dropped customer messages — the same loss as the batching
 * defect arriving through a different door. Degraded means impaired, not absent.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const platformStub = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));

let db: PGlite;

/**
 * A connection in the given state, in its own workspace.
 *
 * meta_connections is unique on (workspace_id, channel) — one WhatsApp
 * connection per tenant — so each fixture needs its own workspace rather than
 * sharing one.
 */
async function connectionWithStatus(status: string, account: string): Promise<string> {
  const workspace = await db.query<{ id: string }>(
    "insert into public.workspaces (name, status) values ($1, 'active') returning id",
    [`ws-${account}`]
  );
  const workspaceId = workspace.rows[0]!.id;
  await db.query(
    `insert into public.meta_connections
       (workspace_id, channel, mode, status, provider_account_id, display_name)
     values ($1, 'whatsapp', 'sandbox', $2, $3, 'probe')`,
    [workspaceId, status, account]
  );
  return workspaceId;
}

async function ingest(account: string, eventId: string) {
  const result = await db.query<{ result: string; trusted_workspace_id: string | null }>(
    `select * from public.ingest_meta_event(
       'whatsapp', $1, $2, 'message', 'sender', null, 'hello', '[]'::jsonb, '{}'::jsonb, now()
     )`,
    [account, eventId]
  );
  return result.rows[0]!;
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
  // Workspace inserts fire the subscription trigger; suppressed because this
  // suite is about connection state, not provisioning.
  await db.exec(`set session_replication_role = replica;`);
});

afterAll(async () => {
  await db?.close();
});

describe("states that accept inbound", () => {
  it.each(["active", "degraded"])("accepts a message on a %s connection", async (status) => {
    const account = `wa-${status}`;
    const workspaceId = await connectionWithStatus(status, account);
    const row = await ingest(account, `wamid.${status}.1`);
    expect(row.result).toBe("accepted");
    expect(row.trusted_workspace_id).toBe(workspaceId);
  });
});

describe("states that refuse inbound", () => {
  it.each(["pending", "policy_blocked", "disabled", "reauth_required", "disconnected"])(
    "reports %s instead of accepting",
    async (status) => {
      const account = `wa-refuse-${status}`;
      await connectionWithStatus(status, account);
      const row = await ingest(account, `wamid.${status}.1`);
      // The status is returned so the caller can surface why, rather than a
      // generic failure that looks like a bug.
      expect(row.result).toBe(status);
    }
  );

  it("still refuses an account it has never seen", async () => {
    const row = await ingest("wa-never-connected", "wamid.unknown.1");
    expect(row.result).toBe("unknown_connection");
  });
});

describe("routing and dedupe are unaffected", () => {
  it("resolves the tenant from the stored connection, never the payload", async () => {
    const workspaceId = await connectionWithStatus("active", "wa-routing");
    const row = await ingest("wa-routing", "wamid.routing.1");
    expect(row.trusted_workspace_id).toBe(workspaceId);
  });

  it("deduplicates a repeated provider event id", async () => {
    await connectionWithStatus("active", "wa-dedupe");
    expect((await ingest("wa-dedupe", "wamid.dedupe.1")).result).toBe("accepted");
    expect((await ingest("wa-dedupe", "wamid.dedupe.1")).result).toBe("duplicate");
  });

  it("enqueues exactly one outbox row per accepted event", async () => {
    await connectionWithStatus("active", "wa-outbox");
    await ingest("wa-outbox", "wamid.outbox.1");
    await ingest("wa-outbox", "wamid.outbox.1");
    const rows = await db.query<{ count: string }>(
      `select count(*)::text as count
         from public.provider_event_outbox o
         join public.meta_webhook_events e on e.id = o.webhook_event_id
        where e.provider_event_id = 'wamid.outbox.1'`
    );
    expect(rows.rows[0]!.count).toBe("1");
  });
});
