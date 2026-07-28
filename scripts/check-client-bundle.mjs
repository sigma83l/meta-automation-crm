import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = ".next/static";
const forbidden = ["SUPABASE_SERVICE_ROLE_KEY", "TURNSTILE_SECRET_KEY", "SMTP_PASSWORD"];
const files = walk(root);
const leaked = files.filter((file) => {
  const content = readFileSync(file, "utf8");
  return forbidden.some((name) => content.includes(name));
});
if (leaked.length > 0) {
  process.stderr.write(
    `Server-only environment names found in client bundle: ${leaked.join(", ")}\n`
  );
  process.exit(1);
}
process.stdout.write(`Client bundle server-secret check passed (${files.length} assets).\n`);

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
