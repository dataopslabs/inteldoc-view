import { test, expect } from '@playwright/test';
import { loginViaLocalStorage } from './helpers/auth';

const KNOWN_WORKSPACE_ID = '12410801-9753-4a69-8cad-5aaa413ed169';

/**
 * Traces page E2E tests.
 */
test.describe('Traces', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaLocalStorage(page);
  });

  test('traces list page loads', async ({ page }) => {
    await page.goto('/traces');
    await page.waitForLoadState('networkidle');
    const url = page.url();
    expect(url).toContain('traces');
  });

  test('traces page shows content', async ({ page }) => {
    await page.goto('/traces');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const pageText = await page.textContent('body');
    const hasContent = pageText?.includes('trace') ||
      pageText?.includes('Trace') ||
      pageText?.includes('Document') ||
      pageText?.includes('Status');
    expect(hasContent).toBe(true);
  });

  test('workspace-scoped traces page loads', async ({ page }) => {
    await page.goto(`/workspaces/${KNOWN_WORKSPACE_ID}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    const pageText = await page.textContent('body');
    expect(pageText).toBeTruthy();
  });
});
