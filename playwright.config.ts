import { defineConfig, devices } from '@playwright/test';
import { assertFresh } from './e2e/freshness';

// Before anything starts: is the dist we are about to drive the current one?
// `__dirname`, not `import.meta.url` — Playwright loads this config as CJS.
assertFresh(__dirname);

const BASE = process.env.ACCTMIND_BASE_URL || '/AcctMind';
const PORT = 8791;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}${BASE}/`,
    trace: 'retain-on-failure',
    // Every speculative interaction gets its own short budget. A click on a
    // control that has gone does NOT fail fast by default — it waits out the
    // whole test timeout and reads as a hang. CalMind hit that four times in
    // one session.
    actionTimeout: 5_000,
  },
  timeout: 30_000,
  expect: { timeout: 5_000 },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The phone shape, because tap targets and the safe area only go wrong
    // when the viewport is small.
    { name: 'mobile', use: { ...devices['iPhone 15'] } },
  ],
  webServer: {
    command: 'node e2e/serve.mjs',
    url: `http://127.0.0.1:${PORT}${BASE}/`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
