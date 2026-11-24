import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const repoRoot = resolve(__dirname, '../..');

/**
 * End-to-end smoke tests for the web app.
 *
 * Playwright brings up both halves of the stack itself — the NestJS API (which
 * needs Postgres/Redis/MinIO from `docker compose`) and the Next.js app — so a
 * single `pnpm test:e2e` exercises a real signed-in flow. The dev servers are
 * used on purpose: they compile on demand, which keeps the run independent of
 * whether a production build happens to be present.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // A single worker keeps the freshly-created workspace fixture predictable and
  // stops concurrent signups from racing on the tenant slug.
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @talentflow/api dev',
      cwd: repoRoot,
      // Probes are mounted outside the versioned prefix (`main.ts`).
      url: 'http://localhost:4000/health/ready',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'pnpm --filter @talentflow/web dev',
      cwd: repoRoot,
      url: 'http://localhost:3000/login',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
