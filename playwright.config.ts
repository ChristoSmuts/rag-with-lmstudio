import { defineConfig, devices } from "@playwright/test";
import { E2E_LM_STUDIO_BASE_URL, E2E_LM_STUDIO_PORT } from "./tests/e2e/constants";

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4322",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "bun tests/e2e/lm-mock-server.ts",
      url: `${E2E_LM_STUDIO_BASE_URL}/models`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "[lm-mock] ready",
      env: {
        ...process.env,
        LM_MOCK_PORT: String(E2E_LM_STUDIO_PORT),
      },
    },
    {
      command: "bun scripts/run-astro.ts dev --host 127.0.0.1 --port 4322",
      url: "http://127.0.0.1:4322",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
