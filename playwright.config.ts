/**
 * GO W3 — Playwright E2E-lite for dashboard fragile flows.
 * Base URL and site ID from env; screenshots/videos on failure.
 */
import { defineConfig, devices } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const authFile = path.join(process.cwd(), 'auth.json');
const useStorageState = fs.existsSync(authFile) ? { storageState: authFile } : {};

export default defineConfig({
  testDir: './tests',
  // Only run Playwright specs. Unit tests live under tests/unit but use node:test.
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    ...useStorageState,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 14'], viewport: { width: 390, height: 844 } } },
  ],
  outputDir: 'test-results/',
});
