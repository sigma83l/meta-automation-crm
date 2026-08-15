import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // See tests/fixtures/server-only-stub.ts — lets unit tests import server
      // modules. The real client/server guard is the Next bundler + bundle:scan.
      "server-only": fileURLToPath(new URL("./tests/fixtures/server-only-stub.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/migrations/**/*.test.ts"
    ],
    // The migration tests boot PGlite — a full PostgreSQL compiled to WASM —
    // and replay every migration in the repository into it. That takes about
    // five seconds on an idle machine, which is to say it sits exactly on
    // Vitest's default 5s timeout and loses the coin toss whenever the machine
    // is busy. A suite that fails on scheduling luck rather than on the SQL is
    // the worst kind of red: it moves around, and it teaches people to re-run
    // rather than to read. The work is genuinely slow, so give it room.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      reporter: ["text", "json", "html"]
    }
  }
});
