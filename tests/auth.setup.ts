/**
 * Auth setup for E2E: run once to save session (Google OAuth).
 * Run: npm run e2e:auth
 * Opens /login; complete Google sign-in manually; saves storage state to auth.json.
 */
import * as path from 'node:path';
import { test as setup } from '@playwright/test';

const authFile = path.join(process.cwd(), 'auth.json');

setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.waitForURL(/\/dashboard/, { timeout: 120000 });
  await page.context().storageState({ path: authFile });
});
