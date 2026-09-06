import Link from "next/link";
import { notFound } from "next/navigation";

import { getRequestPreferences } from "@/src/lib/i18n/server";
import { createCrmRuntime } from "@/src/modules/crm/runtime";
import { CustomerActions } from "@/src/modules/crm/ui/customer-actions";
import { NowCardPanel } from "@/src/modules/crm/ui/now-card";
import { ProposalsPanel } from "@/src/modules/crm/ui/proposals";
import {
  AutomationsSection,
  ConversationsSection,
  FieldsSection,
  FilesSection,
  FollowUpSection,
  MemorySection,
  OverviewSection,
  TimelineSection
} from "@/src/modules/crm/ui/record-sections";
import {
  RECORD_SECTIONS,
  SECTION_LABELS,
  type RecordSection
} from "@/src/modules/crm/ui/vocabulary";
import { isTimelineCategory, type TimelineCategory } from "@/src/modules/crm/timeline";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";
import { BillingEntitlementError } from "@/src/modules/billing/entitlement-gate";
import { EntitlementBlocked } from "@/src/modules/billing/ui/entitlement-blocked";

export const dynamic = "force-dynamic";

/**
 * One customer.
 *
 * `14_RECORD_DETAIL_UX.md` asks for a compact identity header, the Now card,
 * then the working space - and names the raw object dump first among the things
 * to avoid. The Now card is always present because it is what the page is for;
 * the sections below it load only what the chosen one needs, which is the
 * progressive disclosure the same document asks for and the reason a contact
 * with three years of history still opens.
 */
export default async function CustomerPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    section?: string;
    tab?: string;
    category?: string | string[];
    routine?: string;
  }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const section: RecordSection = (RECORD_SECTIONS as readonly string[]).includes(
    query.section ?? ""
  )
    ? (query.section as RecordSection)
    : "overview";
  const { locale } = await getRequestPreferences();
  const text = (english: string, turkish: string, persian: string) =>
    locale === "tr" ? turkish : locale === "fa" ? persian : english;

  let runtime: Awaited<ReturnType<typeof createCrmRuntime>>;
  try {
    runtime = await createCrmRuntime();
  } catch (error) {
    if (error instanceof BillingEntitlementError) {
      return (
        <WorkspaceShell active="crm" workspaceName={error.workspace.name}>
          <div className="content crm-content">
            <EntitlementBlocked locale={locale} status={error.status} />
          </div>
        </WorkspaceShell>
      );
    }
    throw error;
  }
  const { repository, workspace } = runtime;

  // Only the sections that read the record's other tables pay for them.
  const needsDetail = ["overview", "conversations", "automations", "files", "fields", "audit"];
  let header: Awaited<ReturnType<typeof repository.radarRowFor>>;
  let card: Awaited<ReturnType<typeof repository.nowCardFor>>;
  let proposals: Awaited<ReturnType<typeof repository.proposalsFor>>;
  let detail: Readonly<Record<string, unknown>>;
  try {
    // The identity header first, alone. It is the read that answers "is this a
    // contact this workspace has", and running it beside three others means the
    // page fails with whichever of them rejected first - which is how a missing
    // id produced "the workspace view could not be loaded" instead of an
    // answer. It also stops three further queries being spent on a record that
    // is not there.
    header = await repository.radarRowFor(id);
    [card, proposals, detail] = await Promise.all([
      repository.nowCardFor(id),
      // Live suggestions, whichever section is open: they are waiting on a person
      // and burying them behind a tab is how they stay waiting.
      repository.proposalsFor(id),
      needsDetail.includes(section)
        ? repository.detail(id)
        : Promise.resolve({} as Readonly<Record<string, unknown>>)
    ]);
  } catch (error) {
    // A contact this workspace cannot read is not found, whether it never
    // existed or belongs to somebody else. The two must be one answer: a
    // distinct "forbidden" would confirm that an id exists to whoever guessed
    // it. Without this the read threw into the error boundary, so a mistyped
    // URL gave an operator a crash page instead of a sentence.
    if (error instanceof Error && error.message === "CUSTOMER_NOT_FOUND") notFound();
    throw error;
  }
  const rows = (key: string) => (detail[key] ?? []) as readonly Record<string, unknown>[];

  const categories = (
    Array.isArray(query.category) ? query.category : query.category ? [query.category] : []
  ).filter(isTimelineCategory) as TimelineCategory[];
  const includeRoutine = query.routine === "1";

  const [events, facts, followUps, definitions, values] = await Promise.all([
    section === "timeline"
      ? repository.timelineFor(id, { categories, includeRoutine })
      : Promise.resolve([]),
    section === "memory" ? repository.memoryFor(id) : Promise.resolve([]),
    section === "followup" ? repository.followUpsFor(id) : Promise.resolve([]),
    section === "fields" ? repository.customFieldDefinitions() : Promise.resolve([]),
    section === "fields" ? repository.customFieldValuesFor(id) : Promise.resolve([])
  ]);

  return (
    <WorkspaceShell active="crm" workspaceName={workspace.name}>
      <div className="content crm-content">
        <Link href="/crm" className="back-link">
          ← {text("Customer list", "Müşteri listesi", "فهرست مشتریان")}
        </Link>
        <section className="customer-hero">
          <span className="eyebrow">
            {text("Customer profile", "Müşteri profili", "پروفایل مشتری")}
          </span>
          <h2>{header.displayName}</h2>
          {header.companyName ? <p>{header.companyName}</p> : null}
        </section>

        <NowCardPanel card={card} customerId={id} />

        {workspace.role === "viewer" ? null : <ProposalsPanel proposals={proposals} />}

        {workspace.role === "viewer" ? null : (
          <CustomerActions
            customerId={id}
            displayName={header.displayName}
            companyName={header.companyName ?? ""}
          />
        )}

        <nav
          className="detail-tabs"
          aria-label={text("Customer sections", "Kayıt bölümleri", "بخش‌های رکورد")}
        >
          {RECORD_SECTIONS.map((key) => (
            <Link
              key={key}
              href={`/crm/${id}?section=${key}`}
              aria-current={section === key ? "page" : undefined}
            >
              {text(...SECTION_LABELS[key])}
            </Link>
          ))}
        </nav>

        <section className="detail-panel">
          <h3>{text(...SECTION_LABELS[section])}</h3>
          {section === "overview" ? (
            <OverviewSection
              identities={rows("identities")}
              contacts={rows("contacts")}
              consents={rows("consents")}
            />
          ) : null}
          {section === "timeline" ? (
            <TimelineSection
              events={events}
              customerId={id}
              categories={categories}
              includeRoutine={includeRoutine}
            />
          ) : null}
          {section === "conversations" ? (
            <ConversationsSection conversations={rows("conversations")} />
          ) : null}
          {section === "memory" ? (
            <MemorySection facts={facts} now={new Date().toISOString()} />
          ) : null}
          {section === "followup" ? <FollowUpSection followUps={followUps} /> : null}
          {section === "automations" ? (
            <AutomationsSection automations={rows("automations")} />
          ) : null}
          {section === "files" ? <FilesSection files={rows("files")} /> : null}
          {section === "fields" ? (
            <FieldsSection definitions={definitions} values={values} notes={rows("notes")} />
          ) : null}
          {section === "audit" ? (
            <>
              <p className="section-note">
                {text(
                  "The raw event trace, as recorded. Nothing here is summarised.",
                  "Kaydedildiği haliyle ham olay izi. Burada hiçbir şey özetlenmez.",
                  "ردّ رویدادها همان‌گونه که ثبت شده است. اینجا چیزی خلاصه نمی‌شود."
                )}
              </p>
              <OwnerDataView
                value={rows("audit")}
                emptyLabel={text(
                  "No audited action yet.",
                  "Henüz denetlenmiş işlem yok.",
                  "هنوز اقدام ممیزی‌شده‌ای نیست."
                )}
              />
            </>
          ) : null}
        </section>
      </div>
    </WorkspaceShell>
  );
}

/**
 * The raw dump, which now exists only here.
 *
 * Under Audit a trace of exactly what was recorded is the point, and
 * summarising it would defeat the section. Everywhere else it was the thing the
 * pack names first among what to avoid.
 */
function OwnerDataView({ value, emptyLabel }: { value: unknown; emptyLabel: string }) {
  const rows = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  if (!rows.length) return <div className="empty-guidance">{emptyLabel}</div>;
  return (
    <div className="owner-data-list">
      {rows.slice(0, 50).map((row, index) => (
        <article key={index}>
          {Object.entries(row as Record<string, unknown>)
            .filter(([key]) => !/(workspace_id|cipher|secret|token|auth_tag|iv)/i.test(key))
            .slice(0, 12)
            .map(([key, item]) => (
              <div key={key}>
                <strong>{key.replaceAll("_", " ")}</strong>
                <span dir="auto">
                  {item === null || item === undefined
                    ? "—"
                    : typeof item === "object"
                      ? Array.isArray(item)
                        ? `${item.length} items`
                        : "Available"
                      : String(item)}
                </span>
              </div>
            ))}
        </article>
      ))}
    </div>
  );
}
