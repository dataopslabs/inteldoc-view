import { test, expect } from '@playwright/test';
import { loginViaLocalStorage } from './helpers/auth';

/**
 * HITL (Human-in-the-Loop) review queue E2E tests.
 */
test.describe('HITL Review Queue', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaLocalStorage(page);
  });

  test('HITL page loads', async ({ page }) => {
    await page.goto('/hitl');
    await page.waitForLoadState('networkidle');
    const url = page.url();
    expect(url).toContain('hitl');
  });

  test('HITL queue shows empty state or reviews', async ({ page }) => {
    await page.goto('/hitl');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const pageText = await page.textContent('body');
    // Should show either reviews or an empty state message
    const hasContent = pageText?.includes('review') ||
      pageText?.includes('Review') ||
      pageText?.includes('HITL') ||
      pageText?.includes('empty') ||
      pageText?.includes('No pending') ||
      pageText?.includes('queue');
    expect(hasContent).toBe(true);
  });

  test('HITL page does not crash', async ({ page }) => {
    await page.goto('/hitl');
    await page.waitForLoadState('networkidle');

    // Check no error boundary or 500 error visible
    const pageText = await page.textContent('body');
    expect(pageText).not.toContain('Something went wrong');
    expect(pageText).not.toContain('500 Internal Server Error');
  });
});
