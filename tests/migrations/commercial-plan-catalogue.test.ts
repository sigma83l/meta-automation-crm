import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Checks the seeded plan catalogue against the document that specified it.
 *
 * The prices and limits in the migration were transcribed by hand from
 * `docs/commercial/pricing_entitlements_2026-09-v2.json`, and a transcription is
 * exactly the kind of thing that is right on the day and wrong six months later
 * when one of the two is edited alone. Reading the JSON here rather than
 * restating its numbers means the test fails when they disagree, whichever side
 * moved.
 *
 * The JSON is vendored into the repo for the same reason: a spec that lives in
 * somebody's Downloads folder cannot be checked by CI.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const platformStub = fileURLToPath(new URL("./platform-stub.sql", import.meta.url));
const specPath = fileURLToPath(
  new URL("../../docs/commercial/pricing_entitlements_2026-09-v2.json", import.meta.url)
);

type PlanSpec = Readonly<Record<string, number | string | boolean>>;
const spec = JSON.parse(readFileSync(specPath, "utf8")) as Readonly<{
  commercial_plan_version: string;
  currency: string;
  public_plan_names: Readonly<Record<string, string>>;
  plans: Readonly<Record<string, PlanSpec>>;
}>;

type CatalogueRow = Readonly<{
  plan_key: string;
  display_name: string;
  price_minor_units: number;
  currency: string;
  billing_interval: string;
  tier: string | null;
  plan_version: string | null;
  publicly_selectable: boolean;
  active: boolean;
  seats: number | null;
  workspaces: number | null;
  live_connections: number | null;
  managed_connections: number | null;
  mac: number | null;
  crm_contacts: number | null;
  ai_work_units: number | null;
  automation_actions: number | null;
  connector_units: number | null;
  active_workflows: number | null;
  storage_mb: number | null;
  conversation_body_retention_days: number | null;
  knowledge_items: number | null;
  byo_ai: boolean;
  agency: boolean;
}>;

let db: PGlite;
let rows: readonly CatalogueRow[];

/** The pack writes Free in MB and every paid tier in GB. */
function expectedStorageMb(plan: PlanSpec): number {
  return typeof plan.storage_mb === "number" ? plan.storage_mb : Number(plan.storage_gb) * 1024;
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
  const result = await db.query<CatalogueRow>(
    "select * from public.subscription_plans where plan_version = $1 order by sort_order",
    [spec.commercial_plan_version]
  );
  rows = result.rows;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const monthlyOf = (tier: string) =>
  rows.find((row) => row.tier === tier && row.billing_interval === "monthly");
const annualOf = (tier: string) =>
  rows.find((row) => row.tier === tier && row.billing_interval === "annual");

describe("commercial plan catalogue 2026-09-v2", () => {
  it("seeds every tier the pack defines", () => {
    expect(new Set(rows.map((row) => row.tier))).toEqual(new Set(Object.keys(spec.plans)));
  });

  it("prices each monthly tier at the pack's figure, in minor units", () => {
    for (const [tier, plan] of Object.entries(spec.plans)) {
      const row = monthlyOf(tier);
      expect(`${tier}:${row?.price_minor_units}`).toBe(`${tier}:${Number(plan.monthly) * 100}`);
      expect(row?.currency).toBe(spec.currency);
      expect(row?.display_name).toBe(spec.public_plan_names[tier]);
    }
  });

  it("prices each annual tier at the pack's figure", () => {
    for (const [tier, plan] of Object.entries(spec.plans)) {
      const annual = Number(plan.annual);
      const row = annualOf(tier);
      // Free bills nothing yearly, so there is deliberately no annual row: two
      // rows for one zero-priced product is somewhere for them to disagree.
      if (annual === 0) {
        expect(`${tier}:${row === undefined}`).toBe(`${tier}:true`);
        continue;
      }
      expect(`${tier}:${row?.price_minor_units}`).toBe(`${tier}:${annual * 100}`);
    }
  });

  it("carries every numeric entitlement across unchanged", () => {
    const numeric = [
      "seats",
      "workspaces",
      "live_connections",
      "managed_connections",
      "mac",
      "crm_contacts",
      "ai_work_units",
      "automation_actions",
      "connector_units",
      "conversation_body_retention_days",
      "knowledge_items"
    ] as const;

    for (const [tier, plan] of Object.entries(spec.plans)) {
      const row = monthlyOf(tier);
      for (const column of numeric) {
        expect(`${tier}.${column}=${row?.[column]}`).toBe(`${tier}.${column}=${plan[column]}`);
      }
      expect(`${tier}.storage_mb=${row?.storage_mb}`).toBe(
        `${tier}.storage_mb=${expectedStorageMb(plan)}`
      );
    }
  });

  it("records fair-use workflow limits as null rather than inventing a number", () => {
    for (const [tier, plan] of Object.entries(spec.plans)) {
      const row = monthlyOf(tier);
      const expected = plan.active_workflows === "FUP" ? null : Number(plan.active_workflows);
      expect(`${tier}:${row?.active_workflows}`).toBe(`${tier}:${expected}`);
    }
  });

  it("keeps Agency off the self-serve path until its security gates pass", () => {
    // The pack marks Agency REQUEST_ACCESS_UNTIL_MULTI_TENANT_SECURITY_GATES_PASS.
    // The row has to exist so staff can assign it, and has to be unbuyable.
    for (const row of rows.filter((entry) => entry.tier === "agency")) {
      expect(row.publicly_selectable).toBe(false);
    }
    for (const row of rows.filter((entry) => entry.tier !== "agency")) {
      expect(`${row.plan_key}:${row.publicly_selectable}`).toBe(`${row.plan_key}:true`);
    }
  });

  it("matches the pack on BYO AI and agency capability", () => {
    for (const [tier, plan] of Object.entries(spec.plans)) {
      const row = monthlyOf(tier);
      expect(`${tier}.byo_ai=${row?.byo_ai}`).toBe(`${tier}.byo_ai=${plan.byo_ai}`);
      expect(`${tier}.agency=${row?.agency}`).toBe(`${tier}.agency=${plan.agency}`);
    }
  });

  it("retires the old single plan without deleting it", async () => {
    // `workspace_subscriptions.plan_id` is `on delete restrict` and live
    // workspaces point at this row. Deactivating keeps their history readable;
    // deleting would either fail or have to be forced by detaching them first.
    const result = await db.query<{ active: boolean }>(
      "select active from public.subscription_plans where plan_key = 'standard_monthly'"
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.active).toBe(false);
  });

  it("lets a free plan exist, which the original price constraint forbade", async () => {
    const free = monthlyOf("free");
    expect(free?.price_minor_units).toBe(0);
    // And the constraint still refuses a negative price.
    await expect(
      db.query(
        `insert into public.subscription_plans (plan_key, display_name, price_minor_units, currency)
         values ('negative_test', 'Negative', -1, 'USD')`
      )
    ).rejects.toThrow();
  });

  it("gives every seeded plan a full set of feature defaults", async () => {
    const result = await db.query<{ plan_key: string; count: number }>(
      `select p.plan_key, count(d.flag_key)::int as count
       from public.subscription_plans p
       left join public.plan_feature_defaults d on d.plan_id = p.id
       where p.plan_version = $1
       group by p.plan_key
       order by p.plan_key`,
      [spec.commercial_plan_version]
    );
    const flags = await db.query<{ count: number }>(
      "select count(*)::int as count from public.feature_flags"
    );
    const expected = flags.rows[0]?.count ?? 0;
    expect(expected).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(`${row.plan_key}:${row.count}`).toBe(`${row.plan_key}:${expected}`);
    }
  });

  it("provisions a new workspace onto the pack's trial plan, not a null one", async () => {
    // Retiring `standard_monthly` broke the provisioning trigger's hardcoded
    // lookup, and because `plan_id` is nullable the insert would have kept
    // succeeding with no plan attached - invisible until a customer opened a
    // blank billing page. The pack names Growth as `default_trial_plan`.
    const workspace = await db.query<{ id: string }>(
      "insert into public.workspaces (name) values ('Trial default probe') returning id"
    );
    const workspaceId = workspace.rows[0]!.id;
    const result = await db.query<{ plan_key: string; status: string }>(
      `select p.plan_key, s.status
       from public.workspace_subscriptions s
       join public.subscription_plans p on p.id = s.plan_id
       where s.workspace_id = $1`,
      [workspaceId]
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.plan_key).toBe("growth_monthly");
    expect(result.rows[0]?.status).toBe("trialing");
  });

  it("never withholds data export, at any tier including Free", async () => {
    // The billing document is explicit that manual inbox access and export
    // "must not be hostage to usage exhaustion". A free tier that cannot export
    // is a lock-in, not a trial.
    const result = await db.query<{ plan_key: string; enabled: boolean }>(
      `select p.plan_key, d.enabled
       from public.subscription_plans p
       join public.plan_feature_defaults d on d.plan_id = p.id
       where p.plan_version = $1 and d.flag_key = 'crm_export'`,
      [spec.commercial_plan_version]
    );
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(`${row.plan_key}:${row.enabled}`).toBe(`${row.plan_key}:true`);
    }
  });
});
