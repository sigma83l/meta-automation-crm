import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
    "supabase/.temp/**",
    "supabase/.branches/**",
    // Agent worktrees. Each is a full second copy of this repository, so
    // linting here walks every file twice and reports whatever an agent is
    // mid-edit on as a failure of the main checkout. `.prettierignore` and
    // `.vercelignore` exclude the same directory for the same reason.
    ".claude/**"
  ])
]);
