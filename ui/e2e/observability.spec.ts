import { test, expect } from '@playwright/test';
import { loginViaLocalStorage } from './helpers/auth';

/**
 * Observability dashboard E2E tests.
 * Tests metric cards, time range selector, and data loading.
 */
test.describe('Observability Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaLocalStorage(page);
  });

  test('observability page loads without error', async ({ page }) => {
    await page.goto('/observability');
    await page.waitForLoadState('networkidle');

    const pageText = await page.textContent('body');
    expect(pageText).not.toContain('500 Internal Server Error');
    expect(pageText).toBeTruthy();
  });

  test('observability shows metric sections', async ({ page }) => {
    await page.goto('/observability');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); // Wait for API calls

    const pageText = await page.textContent('body');
    // Should contain some observability-related text
    const hasMetrics = pageText?.includes('Trace') ||
      pageText?.includes('trace') ||
      pageText?.includes('Success') ||
      pageText?.includes('Dashboard') ||
      pageText?.includes('Observability');
    expect(hasMetrics).toBe(true);
  });

  test('time range selector is present', async ({ page }) => {
    await page.goto('/observability');
    await page.waitForLoadState('networkidle');

    const pageText = await page.textContent('body');
    // Time range buttons (24h, 7d, 30d)
    const hasTimeRange = pageText?.includes('24h') ||
      pageText?.includes('7d') ||
      pageText?.includes('30d') ||
      pageText?.includes('Last');
    expect(hasTimeRange).toBe(true);
  });
});
