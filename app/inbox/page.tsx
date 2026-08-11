import { getRequestPreferences } from "@/src/lib/i18n/server";
import { createCrmRuntime } from "@/src/modules/crm/runtime";
import { TakeoverControls } from "@/src/modules/conversations/takeover-controls";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams
}: {
  searchParams: Promise<{ conversation?: string }>;
}) {
  const [{ client, workspace }, { locale, t }] = await Promise.all([
    createCrmRuntime(),
    getRequestPreferences()
  ]);
  const text = (english: string, turkish: string, persian: string) =>
    locale === "tr" ? turkish : locale === "fa" ? persian : english;
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
              <span className="eyebrow">{t("inbox.conversations")}</span>
              <h2>{t("nav.inbox")}</h2>
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
                  (conversation.customers as { display_name?: string })?.display_name ??
                    text("Customer", "Müşteri", "مشتری")
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
              <strong>{t("inbox.noConversations")}</strong>
              <span>{t("inbox.noSend")}</span>
            </div>
          ) : null}
        </section>
        <section className="message-pane">
          <a className="inbox-back" href="/inbox">
            ← {text("Back to conversations", "Konuşmalara dön", "بازگشت به گفتگوها")}
          </a>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                {active?.data?.requires_human_review
                  ? text(
                      "Human review required",
                      "İnsan incelemesi gerekli",
                      "نیازمند بررسی انسانی"
                    )
                  : text("Conversation", "Konuşma", "گفتگو")}
              </span>
              <h2>
                {String(
                  (active?.data?.customers as { display_name?: string })?.display_name ??
                    text("Select a conversation", "Bir konuşma seçin", "یک گفتگو انتخاب کنید")
                )}
              </h2>
            </div>
            <span>{active?.data?.owner ?? text("No owner", "Sorumlu yok", "بدون مسئول")}</span>
          </div>
          <div className="message-stream">
            {(messages?.data ?? []).map((message) => (
              <article className={`message ${message.direction}`} key={message.id}>
                <span>{message.direction}</span>
                <p>{message.body}</p>
                <small>{message.status}</small>
              </article>
            ))}
            {activeId && !messages?.data?.length ? (
              <div className="empty-guidance">
                <strong>{text("No messages yet", "Henüz mesaj yok", "هنوز پیامی نیست")}</strong>
                <span>
                  {text(
                    "This conversation is ready for the next inbound message or a human decision.",
                    "Bu görüşme bir sonraki gelen mesajı veya insan kararını bekliyor.",
                    "این گفتگو منتظر پیام ورودی بعدی یا تصمیم اپراتور است."
                  )}
                </span>
              </div>
            ) : null}
          </div>
          {activeId ? (
            <TakeoverControls
              conversationId={activeId}
              owner={active?.data?.owner ?? "automation"}
            />
          ) : null}
        </section>
        <aside className="customer-context">
          <span className="eyebrow">{t("inbox.customerContext")}</span>
          <h3>
            {String(
              (active?.data?.customers as { display_name?: string })?.display_name ??
                text("No customer", "Müşteri yok", "بدون مشتری")
            )}
          </h3>
          <p>
            {text(
              "Consent, tags and recent timeline remain workspace scoped.",
              "Onay, etiketler ve zaman çizelgesi çalışma alanı kapsamındadır.",
              "رضایت، برچسب‌ها و خط زمانی فقط در همین فضای کاری هستند."
            )}
          </p>
          <dl className="context-list">
            <div>
              <dt>{t("inbox.serviceWindow")}</dt>
              <dd>
                {active?.data
                  ? text(
                      "Policy check required",
                      "Politika kontrolü gerekli",
                      "نیازمند بررسی سیاست"
                    )
                  : text("No active window", "Açık pencere yok", "پنجره فعالی نیست")}
              </dd>
            </div>
            <div>
              <dt>{t("inbox.owner")}</dt>
              <dd>{active?.data?.owner ?? text("Unassigned", "Atanmamış", "تخصیص‌نیافته")}</dd>
            </div>
            <div>
              <dt>{t("inbox.missingFields")}</dt>
              <dd>
                {text(
                  "Validated per automation",
                  "Otomasyona göre doğrulanır",
                  "طبق اتوماسیون بررسی می‌شود"
                )}
              </dd>
            </div>
            <div>
              <dt>{t("inbox.attachments")}</dt>
              <dd>
                {messages?.data?.length
                  ? text(
                      "Private media supported",
                      "Özel medya desteklenir",
                      "رسانه خصوصی پشتیبانی می‌شود"
                    )
                  : text("None", "Yok", "هیچ")}
              </dd>
            </div>
          </dl>
          <span className="policy-state">{t("shell.noSend")}</span>
        </aside>
      </div>
    </WorkspaceShell>
  );
}
