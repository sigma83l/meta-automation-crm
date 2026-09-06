#!/usr/bin/env node
/**
 * Verifies that a Supabase project has the schema this repository expects.
 *
 * Written for the region migration, but it is not specific to it: the same
 * check answers "did every migration actually land on this project" for any
 * environment, which is the question that went unanswered long enough to become
 * C-012 in the conflict register.
 *
 * It talks to PostgREST rather than to Postgres directly, because that needs
 * only the URL and the service role key — no database password, no direct
 * connection, nothing that has to be opened up temporarily and then remembered
 * about later.
 *
 * What it proves and what it does not: a table answering a request exists and
 * is exposed. It says nothing about RLS policy behaviour, which needs a real
 * JWT and belongs in the pgTAP suite. Treat a pass here as "the schema is
 * present", not as "the schema is safe".
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node scripts/verify-remote-schema.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

const migrationsDir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));

/**
 * The tables and views the migrations create, read from the migrations
 * themselves.
 *
 * Deriving the list rather than hardcoding it means this script cannot drift
 * from the schema — a hardcoded list silently stops checking whatever was added
 * after somebody last remembered to update it, which is the failure mode that
 * makes verification scripts worse than useless.
 */
function expectedRelations() {
  const relations = new Set();
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"))) {
    const sql = readFileSync(`${migrationsDir}/${file}`, "utf8");
    for (const match of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?(?:table|view)\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi
    )) {
      relations.add(match[1]);
    }
    // `do $$ ... foreach t in array array[...]` blocks name tables as literals;
    // those are already created by their own create table statements, so
    // nothing extra is needed here.
  }
  return [...relations].sort();
}

async function probe(relation) {
  const response = await fetch(`${url}/rest/v1/${relation}?select=*&limit=0`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (response.ok) return { relation, ok: true };
  const body = await response.text();
  // PGRST205 is "relation not found in schema cache", which is the specific
  // answer meaning the migration did not land. Anything else is a different
  // problem and should not be reported as a missing table.
  const missing = body.includes("PGRST205");
  return { relation, ok: false, missing, status: response.status };
}

const relations = expectedRelations();
console.log(`Checking ${relations.length} relations against ${new URL(url).host}\n`);

const results = [];
for (const relation of relations) {
  results.push(await probe(relation));
}

const missing = results.filter((result) => !result.ok && result.missing);
const errored = results.filter((result) => !result.ok && !result.missing);

for (const result of missing) console.log(`  MISSING  ${result.relation}`);
for (const result of errored) console.log(`  ERROR    ${result.relation} (HTTP ${result.status})`);

console.log(
  `\n${results.length - missing.length - errored.length}/${results.length} present` +
    (missing.length ? `, ${missing.length} missing` : "") +
    (errored.length ? `, ${errored.length} errored` : "")
);

if (missing.length || errored.length) {
  console.log("\nMigrations have not fully applied to this project.");
  process.exit(1);
}
console.log(
  "\nSchema is present. This does not verify RLS behaviour — see supabase/tests/database."
);
