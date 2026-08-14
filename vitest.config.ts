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
    coverage: {
      reporter: ["text", "json", "html"]
    }
  }
});
