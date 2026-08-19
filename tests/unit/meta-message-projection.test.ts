import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/tests/fixtures/fake-supabase";
import { projectMetaMessage } from "@/src/modules/integrations/meta/message-projection";

/**
 * The boundary around `project_meta_message`.
 *
 * The projection itself is executed against a real PostgreSQL engine in
 * tests/migrations. What is worth pinning here is the part that is TypeScript:
 * that an outcome nobody recognises is refused rather than passed on as if it
 * meant success, because the caller decides whether to answer a customer based
 * on this value alone.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";

function withRpcResult(rows: unknown) {
  return createFakeSupabase({
    rpc: { project_meta_message: () => ({ data: rows, error: null, count: null }) }
  });
}

describe("reading a projection result", () => {
  it("returns the identifiers a turn needs", async () => {
    const fake = withRpcResult([
      {
        result: "projected",
        customer_id: "cus-1",
        conversation_id: "con-1",
        message_id: "msg-1"
      }
    ]);
    await expect(projectMetaMessage(fake.client, EVENT, WORKSPACE)).resolves.toEqual({
      result: "projected",
      customerId: "cus-1",
      conversationId: "con-1",
      messageId: "msg-1"
    });
  });

  it("passes the workspace through rather than letting the function infer it", async () => {
    const fake = withRpcResult([
      { result: "skipped", customer_id: null, conversation_id: null, message_id: null }
    ]);
    await projectMetaMessage(fake.client, EVENT, WORKSPACE);
    expect(fake.database.rpcArgs("project_meta_message")[0]).toEqual({
      p_webhook_event_id: EVENT,
      p_workspace_id: WORKSPACE
    });
  });

  it("omits identifiers the projection did not produce", async () => {
    const fake = withRpcResult([
      { result: "duplicate", customer_id: "cus-1", conversation_id: "con-1", message_id: null }
    ]);
    const projected = await projectMetaMessage(fake.client, EVENT, WORKSPACE);
    expect(projected).toEqual({
      result: "duplicate",
      customerId: "cus-1",
      conversationId: "con-1"
    });
    expect("messageId" in projected).toBe(false);
  });
});

describe("results that must not be mistaken for success", () => {
  it("refuses an empty result set", async () => {
    // The function returns a row on every path, so nothing coming back means
    // it did not run as written — which is not the same as "nothing to do".
    const fake = withRpcResult([]);
    await expect(projectMetaMessage(fake.client, EVENT, WORKSPACE)).rejects.toThrow(
      "MESSAGE_PROJECTION_FAILED"
    );
  });

  it("refuses an outcome it does not recognise", async () => {
    const fake = withRpcResult([
      { result: "something_new", customer_id: null, conversation_id: null, message_id: null }
    ]);
    await expect(projectMetaMessage(fake.client, EVENT, WORKSPACE)).rejects.toThrow(
      "MESSAGE_PROJECTION_FAILED"
    );
  });

  it("refuses a database error", async () => {
    const fake = createFakeSupabase({
      rpc: {
        project_meta_message: () => ({
          data: null,
          error: { code: "42883", message: "no such function" },
          count: null
        })
      }
    });
    await expect(projectMetaMessage(fake.client, EVENT, WORKSPACE)).rejects.toThrow(
      "MESSAGE_PROJECTION_FAILED"
    );
  });
});
