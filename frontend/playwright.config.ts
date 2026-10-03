import { defineConfig } from "@playwright/test";

/**
 * Runs against the running stack (`docker compose up -d`): the web app on
 * :5173, whose Vite proxy forwards /api to the api container. Nothing is
 * started here, exactly like `scripts/smoke.mjs`.
 *
 * Chrome is the installed Google Chrome (`channel: "chrome"`) — the same
 * binary the puppeteer smoke script drives — so no browser download is needed.
 */
const BASE_URL = process.env.ONEMART_WEB ?? "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      args: ["--no-sandbox", "--disable-gpu", "--no-proxy-server", "--proxy-bypass-list=*"],
    },
  },
});
