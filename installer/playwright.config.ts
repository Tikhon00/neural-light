import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  workers: 1,
  fullyParallel: false,
  outputDir: "../test-results/installer",
  use: {
    channel: process.env.CI ? undefined : "chrome",
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run installer:dev",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: !process.env.CI,
  },
});
