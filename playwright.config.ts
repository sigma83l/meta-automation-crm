import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /cross-browser\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile-chromium",
      testIgnore: /cross-browser\.spec\.ts/,
      use: { ...devices["Pixel 7"] }
    },
    {
      name: "firefox-smoke",
      testMatch: /cross-browser\.spec\.ts/,
      use: { ...devices["Desktop Firefox"] }
    },
    {
      name: "webkit-smoke",
      testMatch: /cross-browser\.spec\.ts/,
      use: { ...devices["Desktop Safari"] }
    }
  ],
  webServer: {
    // CI has already completed the production build, so exercise that stable
    // server instead of compiling every authenticated route on demand. Local
    // runs keep the Webpack dev server for fast iteration and reliable HMR.
    command: process.env.CI
      ? "pnpm start --hostname 127.0.0.1"
      : "pnpm dev --webpack --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
