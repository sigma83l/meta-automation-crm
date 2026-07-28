import { createCrmRuntime } from "@/src/modules/crm/runtime";
import { TakeoverControls } from "@/src/modules/conversations/takeover-controls";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams
}: {
  searchParams: Promise<{ conversation?: string }>;
}) {
  const { client, workspace } = await createCrmRuntime();
  const conversations = await client
    .from("conversations")
    .select("*,customers(display_name)")
    .eq("workspace_id", workspace.id)
    .order("last_message_at", { ascending: false });
  const requestedId = (await searchParams).conversation;
  const activeId = requestedId ?? conversations.data?.[0]?.id;
  const active = activeId
    ? await client
        .from("conversations")
        .select("*,customers(*)")
        .eq("workspace_id", workspace.id)
        .eq("id", activeId)
        .single()
    : null;
  const messages = activeId
    ? await client
        .from("messages")
        .select("*")
        .eq("workspace_id", workspace.id)
        .eq("conversation_id", activeId)
        .order("sent_at")
    : null;
  return (
    <WorkspaceShell active="inbox" workspaceName={workspace.name}>
      <div className={`inbox-grid ${requestedId ? "show-conversation" : "show-list"}`}>
        <section className="conversation-list">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Conversations</span>
              <h2>Inbox</h2>
            </div>
          </div>
          {(conversations.data ?? []).map((conversation) => (
            <a
              href={`/inbox?conversation=${conversation.id}`}
              className={conversation.id === activeId ? "conversation active" : "conversation"}
              key={conversation.id}
            >
              <strong>
                {String(
                  (conversation.customers as { display_name?: string })?.display_name ?? "Customer"
                )}
              </strong>
              <span>
                {conversation.channel} · {conversation.owner}
              </span>
              {conversation.unread_count ? <b>{conversation.unread_count}</b> : null}
            </a>
          ))}
          {!conversations.data?.length ? (
            <div className="empty-guidance">
              <strong>No conversations yet.</strong>
              <span>Provider sending remains disabled.</span>
            </div>
          ) : null}
        </section>
        <section className="message-pane">
          <a className="inbox-back" href="/inbox">
            ← Back to conversations
          </a>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                {active?.data?.requires_human_review ? "Human review required" : "Conversation"}
              </span>
              <h2>
                {String(
                  (active?.data?.customers as { display_name?: string })?.display_name ??
                    "Select a conversation"
                )}
              </h2>
            </div>
            <span>{active?.data?.owner ?? "No owner"}</span>
          </div>
          <div className="message-stream">
            {(messages?.data ?? []).map((message) => (
              <article className={`message ${message.direction}`} key={message.id}>
                <span>{message.direction}</span>
                <p>{message.body}</p>
                <small>{message.status}</small>
              </article>
            ))}
          </div>
          {activeId ? (
            <TakeoverControls
              conversationId={activeId}
              owner={active?.data?.owner ?? "automation"}
            />
          ) : null}
        </section>
        <aside className="customer-context">
          <span className="eyebrow">Customer context</span>
          <h3>
            {String(
              (active?.data?.customers as { display_name?: string })?.display_name ?? "No customer"
            )}
          </h3>
          <p>Consent, tags and recent timeline remain workspace scoped.</p>
          <dl className="context-list">
            <div>
              <dt>Service window</dt>
              <dd>{active?.data ? "Policy check required" : "No active window"}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{active?.data?.owner ?? "Unassigned"}</dd>
            </div>
            <div>
              <dt>Missing fields</dt>
              <dd>Validated per automation</dd>
            </div>
            <div>
              <dt>Attachments</dt>
              <dd>{messages?.data?.length ? "Private media supported" : "None"}</dd>
            </div>
          </dl>
          <span className="policy-state">No real send</span>
        </aside>
      </div>
    </WorkspaceShell>
  );
}
