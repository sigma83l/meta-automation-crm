import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import type { Recipe } from "./engine";
const recipes = new Set<Recipe>([
  "INSTAGRAM_COMMENT_TO_DM",
  "INSTAGRAM_INBOUND_DM",
  "WHATSAPP_INBOUND"
]);
export async function listAutomations(workspace: TrustedWorkspace) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("automations")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("updated_at", { ascending: false });
  if (error) throw new Error("Automations unavailable.");
  return data ?? [];
}
export async function createAutomation(
  workspace: TrustedWorkspace,
  input: {
    name: string;
    recipe: Recipe;
    requestId: string;
    configuration?: {
      questions?: unknown;
      tone?: unknown;
      quietHours?: unknown;
      frequencyCap?: unknown;
    };
  }
) {
  if (!recipes.has(input.recipe) || input.name.trim().length < 2)
    throw new Error("Invalid automation.");
  if (!/^[0-9a-f-]{36}$/i.test(input.requestId)) throw new Error("Invalid request.");
  const admin = createSupabaseAdminClient();
  const reservation = await admin.from("automation_idempotency_keys").insert({
    workspace_id: workspace.id,
    key: input.requestId,
    scope: "automation_create",
    status: "reserved"
  });
  if (reservation.error) {
    const previous = await admin
      .from("automation_idempotency_keys")
      .select("scope,status")
      .eq("workspace_id", workspace.id)
      .eq("key", input.requestId)
      .maybeSingle();
    const existingId = previous.data?.scope.startsWith("automation_create:")
      ? previous.data.scope.slice("automation_create:".length)
      : null;
    if (existingId) return { id: existingId, status: "READY_TO_TEST" };
    throw new Error("Automation request is already processing.");
  }
  const automation = await admin
    .from("automations")
    .insert({
      workspace_id: workspace.id,
      name: input.name.trim(),
      recipe: input.recipe,
      status: "READY_TO_TEST"
    })
    .select("id")
    .single();
  if (automation.error || !automation.data) {
    await admin
      .from("automation_idempotency_keys")
      .delete()
      .eq("workspace_id", workspace.id)
      .eq("key", input.requestId);
    throw new Error("Automation creation failed.");
  }
  const automationId = automation.data.id;
  async function rollbackDraft() {
    await admin
      .from("automations")
      .update({ active_version_id: null })
      .eq("workspace_id", workspace.id)
      .eq("id", automationId);
    await admin
      .from("automations")
      .delete()
      .eq("workspace_id", workspace.id)
      .eq("id", automationId);
    await admin
      .from("automation_idempotency_keys")
      .delete()
      .eq("workspace_id", workspace.id)
      .eq("key", input.requestId);
  }
  const configuredQuestions = Array.isArray(input.configuration?.questions)
    ? input.configuration.questions
        .filter((question): question is string => typeof question === "string")
        .map((question) => question.trim())
        .filter(Boolean)
        .slice(0, 20)
    : ["Name", "Email"];
  const configuration = {
    recipe: input.recipe,
    questions: configuredQuestions,
    tone:
      typeof input.configuration?.tone === "string"
        ? input.configuration.tone.slice(0, 40)
        : "workspace-default",
    quietHours: input.configuration?.quietHours !== false,
    frequencyCap:
      typeof input.configuration?.frequencyCap === "number"
        ? Math.min(20, Math.max(1, Math.trunc(input.configuration.frequencyCap)))
        : 3,
    sandbox: true
  };
  const version = await admin
    .from("automation_versions")
    .insert({
      workspace_id: workspace.id,
      automation_id: automationId,
      version: 1,
      configuration,
      content_hash: createHash("sha256").update(JSON.stringify(configuration)).digest("hex")
    })
    .select("id")
    .single();
  if (version.error) {
    await rollbackDraft();
    throw new Error("Automation version failed.");
  }
  const activation = await admin
    .from("automations")
    .update({ active_version_id: version.data.id })
    .eq("workspace_id", workspace.id)
    .eq("id", automationId);
  if (activation.error) {
    await rollbackDraft();
    throw new Error("Automation version activation failed.");
  }
  const questions = await admin.from("automation_questions").insert(
    ["name", "email"].map((field_key, position) => ({
      workspace_id: workspace.id,
      automation_version_id: version.data.id,
      field_key,
      prompt: field_key === "name" ? "What should we call you?" : "What email can we use?",
      position,
      required: true
    }))
  );
  if (questions.error) {
    await rollbackDraft();
    throw new Error("Automation questions failed.");
  }
  const completed = await admin
    .from("automation_idempotency_keys")
    .update({ scope: `automation_create:${automationId}`, status: "completed" })
    .eq("workspace_id", workspace.id)
    .eq("key", input.requestId);
  if (completed.error) {
    await rollbackDraft();
    throw new Error("Automation idempotency completion failed.");
  }
  return { id: automationId, status: "READY_TO_TEST" };
}
export async function updateAutomation(
  workspace: TrustedWorkspace,
  id: string,
  action: "activate" | "pause" | "archive" | "safe_test" | "stop_queued"
) {
  const admin = createSupabaseAdminClient();
  const status =
    action === "activate"
      ? "ACTIVE"
      : action === "pause"
        ? "PAUSED"
        : action === "archive"
          ? "ARCHIVED"
          : action === "safe_test"
            ? "READY"
            : "PAUSED";
  const result = await admin
    .from("automations")
    .update({ status, ...(action === "pause" ? { paused_at: new Date().toISOString() } : {}) })
    .eq("workspace_id", workspace.id)
    .eq("id", id)
    .select("id")
    .single();
  if (result.error) throw new Error("Automation action failed.");
  if (action === "stop_queued") {
    const runs = await admin
      .from("automation_runs")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("automation_id", id);
    if (runs.error) throw new Error("Queued runs unavailable.");
    const runIds = (runs.data ?? []).map((run) => run.id);
    if (runIds.length) {
      const cancelled = await admin
        .from("automation_run_steps")
        .update({ status: "cancelled" })
        .eq("workspace_id", workspace.id)
        .in("run_id", runIds)
        .in("status", ["queued", "retrying"]);
      if (cancelled.error) throw new Error("Queued steps could not be cancelled.");
    }
  }
  const audit = await admin.from("automation_audit_events").insert({
    workspace_id: workspace.id,
    automation_id: id,
    actor_id: workspace.userId,
    event_type: `automation.${action}`,
    safe_details: {}
  });
  if (audit.error) throw new Error("Automation audit failed.");
  return { status };
}
