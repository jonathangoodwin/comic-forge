import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
config({ path: ".env.local" });

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3006",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "npm run dev -- -p 3006",
    url: "http://localhost:3006",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
