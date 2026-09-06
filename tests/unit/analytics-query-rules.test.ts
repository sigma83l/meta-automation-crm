import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildCacheKey,
  clampPageSize,
  decodeCursor,
  encodeCursor,
  isSafeCacheKey,
  toPage
} from "@/src/modules/analytics/query-rules";

const SECRET = "cursor-signing-secret-at-least-32-characters";
const WORKSPACE = "ws_1";

const row = (id: string, occurredAt: string) => ({ id, occurredAt });

describe("no query is unbounded", () => {
  it("defaults when no size is asked for", () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
  });

  it("honours a reasonable request", () => {
    expect(clampPageSize(50)).toBe(50);
  });

  it("clamps an over-eager one rather than refusing it", () => {
    // Usually a UI bug or a script; a hundred rows is more useful than an
    // error, and honouring the request is what makes a shared database
    // unresponsive for everybody.
    expect(clampPageSize(100_000)).toBe(MAX_PAGE_SIZE);
  });

  it("refuses nonsense sizes", () => {
    for (const size of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(`${size}:${clampPageSize(size)}`).toBe(`${size}:${DEFAULT_PAGE_SIZE}`);
    }
  });
});

describe("cursors are keyset, not offset", () => {
  it("carries both the sort key and a tie-break", () => {
    // Rows sharing a timestamp must be neither skipped nor repeated.
    const token = encodeCursor(
      { occurredAt: "2026-08-16T10:00:00.000Z", id: "m_9" },
      WORKSPACE,
      SECRET
    );
    expect(decodeCursor(token, WORKSPACE, SECRET)).toEqual({
      occurredAt: "2026-08-16T10:00:00.000Z",
      id: "m_9"
    });
  });

  it("refuses a hand-edited cursor", () => {
    // The value goes straight into a query predicate.
    const token = encodeCursor(
      { occurredAt: "2026-08-16T10:00:00.000Z", id: "m_9" },
      WORKSPACE,
      SECRET
    );
    const [payload, signature] = token.split(".");
    const forged = `${Buffer.from("2020-01-01T00:00:00.000Z|m_1", "utf8").toString("base64url")}.${signature}`;
    expect(forged).not.toBe(token);
    expect(payload).toBeDefined();
    expect(decodeCursor(forged, WORKSPACE, SECRET)).toBeNull();
  });

  it("refuses a cursor carried from another workspace", () => {
    // The query is workspace-scoped regardless, but a cursor that verifies
    // across tenants is a loose end a later refactor can turn into a leak.
    const token = encodeCursor(
      { occurredAt: "2026-08-16T10:00:00.000Z", id: "m_9" },
      WORKSPACE,
      SECRET
    );
    expect(decodeCursor(token, "ws_2", SECRET)).toBeNull();
  });

  it("refuses a cursor signed with another key", () => {
    const token = encodeCursor(
      { occurredAt: "2026-08-16T10:00:00.000Z", id: "m_9" },
      WORKSPACE,
      "another-secret-entirely-at-least-32-chars"
    );
    expect(decodeCursor(token, WORKSPACE, SECRET)).toBeNull();
  });

  it("refuses malformed tokens without throwing", () => {
    for (const token of ["", ".", "nodot", "a.b", "...."]) {
      expect(`${token}:${decodeCursor(token, WORKSPACE, SECRET)}`).toBe(`${token}:null`);
    }
  });

  it("refuses a validly signed cursor with an unusable timestamp", () => {
    const token = encodeCursor({ occurredAt: "not a date", id: "m_9" }, WORKSPACE, SECRET);
    expect(decodeCursor(token, WORKSPACE, SECRET)).toBeNull();
  });
});

describe("paging without a count query", () => {
  const fetched = [
    row("m_1", "2026-08-16T10:00:03.000Z"),
    row("m_2", "2026-08-16T10:00:02.000Z"),
    row("m_3", "2026-08-16T10:00:01.000Z")
  ];

  it("returns a next cursor when the extra row came back", () => {
    // The extra row is how "is there more" gets answered without a count query,
    // which on a large workspace-scoped table is the unbounded query the rules
    // forbid.
    const page = toPage(fetched, 2);
    expect(page.rows.map((entry) => entry.id)).toEqual(["m_1", "m_2"]);
    expect(page.nextCursor).toEqual({ occurredAt: "2026-08-16T10:00:02.000Z", id: "m_2" });
  });

  it("returns no cursor on the last page", () => {
    const page = toPage(fetched, 3);
    expect(page.rows).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it("handles an empty result", () => {
    expect(toPage([], 25)).toEqual({ rows: [], nextCursor: null });
  });

  it("points the cursor at the last returned row, not the extra one", () => {
    // Pointing at the unreturned row would skip it on the next page.
    expect(toPage(fetched, 2).nextCursor?.id).toBe("m_2");
  });
});

describe("cache keys cannot cross a tenant or a role", () => {
  it("includes workspace, role, resource and version", () => {
    expect(
      buildCacheKey({ workspaceId: "ws_1", role: "member", resource: "inbox", version: "3" })
    ).toBe("ws=ws_1:role=member:res=inbox:v=3");
  });

  it("separates two workspaces", () => {
    const a = buildCacheKey({
      workspaceId: "ws_1",
      role: "owner",
      resource: "usage",
      version: "1"
    });
    const b = buildCacheKey({
      workspaceId: "ws_2",
      role: "owner",
      resource: "usage",
      version: "1"
    });
    expect(a).not.toBe(b);
  });

  it("separates two roles in one workspace", () => {
    // Otherwise a member is served what an owner cached.
    const owner = buildCacheKey({
      workspaceId: "ws_1",
      role: "owner",
      resource: "billing",
      version: "1"
    });
    const member = buildCacheKey({
      workspaceId: "ws_1",
      role: "member",
      resource: "billing",
      version: "1"
    });
    expect(owner).not.toBe(member);
  });

  it("separates two versions, so a deploy cannot serve the old shape", () => {
    const before = buildCacheKey({
      workspaceId: "ws_1",
      role: "owner",
      resource: "inbox",
      version: "1"
    });
    const after = buildCacheKey({
      workspaceId: "ws_1",
      role: "owner",
      resource: "inbox",
      version: "2"
    });
    expect(before).not.toBe(after);
  });

  it("orders discriminators so one filter yields one key", () => {
    const a = buildCacheKey({
      workspaceId: "ws_1",
      role: "owner",
      resource: "inbox",
      version: "1",
      discriminators: { status: "open", channel: "whatsapp" }
    });
    const b = buildCacheKey({
      workspaceId: "ws_1",
      role: "owner",
      resource: "inbox",
      version: "1",
      discriminators: { channel: "whatsapp", status: "open" }
    });
    expect(a).toBe(b);
  });

  it("rejects a key with an empty workspace, which would collide everywhere", () => {
    expect(
      isSafeCacheKey(
        buildCacheKey({ workspaceId: "", role: "owner", resource: "inbox", version: "1" })
      )
    ).toBe(false);
  });

  it("rejects a key with an empty role or version", () => {
    expect(
      isSafeCacheKey(buildCacheKey({ workspaceId: "ws_1", role: "", resource: "x", version: "1" }))
    ).toBe(false);
    expect(
      isSafeCacheKey(
        buildCacheKey({ workspaceId: "ws_1", role: "owner", resource: "x", version: "" })
      )
    ).toBe(false);
  });

  it("accepts a fully specified key", () => {
    expect(
      isSafeCacheKey(
        buildCacheKey({ workspaceId: "ws_1", role: "owner", resource: "inbox", version: "1" })
      )
    ).toBe(true);
  });
});
