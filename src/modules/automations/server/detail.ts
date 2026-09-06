import "server-only";

import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import type { AutomationTabId } from "@/src/modules/automations/detail-tabs";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";

/**
 * Everything the automation detail page shows, per tab.
 *
 * Loaded per tab rather than all at once: Overview is the tab almost every
 * visit lands on, and making it wait on version history and run analytics it
 * will not render would be a cost paid on every page view for the benefit of
 * the few that switch.
 *
 * Every query is scoped by `workspace_id` as well as by automation id. The
 * automation id came from the URL, and the tenant seam is that no read is
 * addressed by an id alone.
 */

export type AutomationRow = Readonly<{
  id: string;
  name: string;
  recipe: string;
  status: string;
  activeVersionId: string | null;
  pausedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type OverviewPanel = Readonly<{
  activeVersion: Readonly<{ version: number; createdAt: string }> | undefined;
  lastFailure: Readonly<{ errorCode: string; summary: string; createdAt: string }> | undefined;
  queuedSteps: number;
}>;

export type RunRow = Readonly<{
  id: string;
  state: string;
  conversationId: string;
  mediaCount: number;
  humanPaused: boolean;
  failureCode: string | null;
  updatedAt: string;
}>;

export type ActivityRow = Readonly<{
  id: string;
  eventType: string;
  createdAt: string;
}>;

export type RunsPanel = Readonly<{
  runs: readonly RunRow[];
  activity: readonly ActivityRow[];
}>;

export type VersionRow = Readonly<{
  id: string;
  version: number;
  contentHash: string;
  createdAt: string;
  isActive: boolean;
}>;

export type AnalyticsPanel = Readonly<{
  runsByState: readonly Readonly<{ state: string; count: number }>[];
  attemptsByStatus: readonly Readonly<{ status: string; count: number }>[];
  deadLetters: number;
  actionsTaken: number;
}>;

export type SettingsPanel = Readonly<{
  version: number | undefined;
  configuration: Readonly<Record<string, unknown>> | undefined;
  questions: readonly Readonly<{ fieldKey: string; prompt: string; required: boolean }>[];
}>;

export type AutomationDetail = Readonly<{
  automation: AutomationRow;
  overview?: OverviewPanel;
  runs?: RunsPanel;
  versions?: readonly VersionRow[];
  analytics?: AnalyticsPanel;
  settings?: SettingsPanel;
}>;

/** Groups rows by one text column, so a tab can show counts without an RPC. */
function tally(rows: readonly Readonly<Record<string, unknown>>[], column: string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[column] ?? "unknown");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count }));
}

export async function loadAutomationDetail(
  workspace: TrustedWorkspace,
  automationId: string,
  tab: AutomationTabId
): Promise<AutomationDetail | undefined> {
  const admin = await createSupabaseAdminClient();
  const { data, error } = await admin
    .from("automations")
    .select("id,name,recipe,status,active_version_id,paused_at,created_at,updated_at")
    .eq("workspace_id", workspace.id)
    .eq("id", automationId)
    .maybeSingle();
  if (error) throw new Error("Automation unavailable.");
  if (!data) return undefined;

  const automation: AutomationRow = {
    id: String(data.id),
    name: String(data.name),
    recipe: String(data.recipe),
    status: String(data.status),
    activeVersionId: (data.active_version_id as string | null) ?? null,
    pausedAt: (data.paused_at as string | null) ?? null,
    createdAt: String(data.created_at),
    updatedAt: String(data.updated_at)
  };

  if (tab === "overview") {
    const [version, runIds] = await Promise.all([
      automation.activeVersionId
        ? admin
            .from("automation_versions")
            .select("version,created_at")
            .eq("workspace_id", workspace.id)
            .eq("id", automation.activeVersionId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      admin
        .from("automation_runs")
        .select("id")
        .eq("workspace_id", workspace.id)
        .eq("automation_id", automationId)
    ]);

    const ids = (runIds.data ?? []).map((row) => String(row.id));
    // Both of these hang off run ids, not the automation: `automation_runs` is
    // the only table that carries `automation_id`. Filtering dead letters by
    // workspace alone would show this automation another one's failure, which
    // is worse than showing none.
    const [failure, queued] = await Promise.all([
      ids.length
        ? admin
            .from("automation_dead_letters")
            .select("error_code,safe_summary,created_at")
            .eq("workspace_id", workspace.id)
            .in("run_id", ids)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      // Counted rather than fetched: the card shows a number, and the steps
      // themselves belong to the Runs tab.
      ids.length
        ? admin
            .from("automation_run_steps")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", workspace.id)
            .in("run_id", ids)
            .in("status", ["queued", "retrying"])
        : Promise.resolve({ count: 0 })
    ]);

    return {
      automation,
      overview: {
        activeVersion: version.data
          ? {
              version: Number(version.data.version),
              createdAt: String(version.data.created_at)
            }
          : undefined,
        lastFailure: failure.data
          ? {
              errorCode: String(failure.data.error_code),
              summary: String(failure.data.safe_summary),
              createdAt: String(failure.data.created_at)
            }
          : undefined,
        queuedSteps: queued.count ?? 0
      }
    };
  }

  if (tab === "runs") {
    const [runs, activity] = await Promise.all([
      admin
        .from("automation_runs")
        .select("id,state,conversation_id,media_count,human_paused,failure_code,updated_at")
        .eq("workspace_id", workspace.id)
        .eq("automation_id", automationId)
        .order("updated_at", { ascending: false })
        .limit(50),
      admin
        .from("automation_audit_events")
        .select("id,event_type,created_at")
        .eq("workspace_id", workspace.id)
        .eq("automation_id", automationId)
        .order("created_at", { ascending: false })
        .limit(25)
    ]);
    return {
      automation,
      runs: {
        runs: (runs.data ?? []).map((row) => ({
          id: String(row.id),
          state: String(row.state),
          conversationId: String(row.conversation_id),
          mediaCount: Number(row.media_count ?? 0),
          humanPaused: Boolean(row.human_paused),
          failureCode: (row.failure_code as string | null) ?? null,
          updatedAt: String(row.updated_at)
        })),
        activity: (activity.data ?? []).map((row) => ({
          id: String(row.id),
          eventType: String(row.event_type),
          createdAt: String(row.created_at)
        }))
      }
    };
  }

  if (tab === "versions") {
    const { data: rows } = await admin
      .from("automation_versions")
      .select("id,version,content_hash,created_at")
      .eq("workspace_id", workspace.id)
      .eq("automation_id", automationId)
      .order("version", { ascending: false });
    return {
      automation,
      versions: (rows ?? []).map((row) => ({
        id: String(row.id),
        version: Number(row.version),
        contentHash: String(row.content_hash),
        createdAt: String(row.created_at),
        isActive: String(row.id) === automation.activeVersionId
      }))
    };
  }

  if (tab === "analytics") {
    const runs = await admin
      .from("automation_runs")
      .select("id,state")
      .eq("workspace_id", workspace.id)
      .eq("automation_id", automationId);
    const ids = (runs.data ?? []).map((row) => String(row.id));
    const [attempts, deadLetters, actions] = await Promise.all([
      ids.length
        ? admin
            .from("outbound_attempts")
            .select("status")
            .eq("workspace_id", workspace.id)
            .in("run_id", ids)
        : Promise.resolve({ data: [] }),
      ids.length
        ? admin
            .from("automation_dead_letters")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", workspace.id)
            .in("run_id", ids)
        : Promise.resolve({ count: 0 }),
      admin
        .from("automation_audit_events")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .eq("automation_id", automationId)
    ]);
    return {
      automation,
      analytics: {
        runsByState: tally(runs.data ?? [], "state").map(({ key, count }) => ({
          state: key,
          count
        })),
        attemptsByStatus: tally(attempts.data ?? [], "status").map(({ key, count }) => ({
          status: key,
          count
        })),
        deadLetters: deadLetters.count ?? 0,
        actionsTaken: actions.count ?? 0
      }
    };
  }

  const versionId = automation.activeVersionId;
  const [version, questions] = await Promise.all([
    versionId
      ? admin
          .from("automation_versions")
          .select("version,configuration")
          .eq("workspace_id", workspace.id)
          .eq("id", versionId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    versionId
      ? admin
          .from("automation_questions")
          .select("field_key,prompt,required,position")
          .eq("workspace_id", workspace.id)
          .eq("automation_version_id", versionId)
          .order("position", { ascending: true })
      : Promise.resolve({ data: [] })
  ]);
  return {
    automation,
    settings: {
      version: version.data ? Number(version.data.version) : undefined,
      configuration:
        (version.data?.configuration as Record<string, unknown> | undefined) ?? undefined,
      questions: (questions.data ?? []).map((row) => ({
        fieldKey: String(row.field_key),
        prompt: String(row.prompt),
        required: Boolean(row.required)
      }))
    }
  };
}
