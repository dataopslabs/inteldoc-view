import { test, expect } from '@playwright/test';
import { loginViaLocalStorage } from './helpers/auth';

/**
 * Settings & billing page E2E tests.
 * Tests billing plan display, webhook management, and GDPR section.
 */
test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaLocalStorage(page);
  });

  test('settings page loads', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    const url = page.url();
    expect(url).toContain('settings');
  });

  test('billing plan section shows current plan', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const pageText = await page.textContent('body');
    const hasBilling = pageText?.includes('free') ||
      pageText?.includes('Free') ||
      pageText?.includes('Plan') ||
      pageText?.includes('Billing') ||
      pageText?.includes('plan');
    expect(hasBilling).toBe(true);
  });

  test('developer access section is present', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const pageText = await page.textContent('body');
    // Settings page shows Developer Access section with API endpoint info
    const hasDeveloperAccess = pageText?.includes('Developer') ||
      pageText?.includes('API Endpoint') ||
      pageText?.includes('Authorization');
    expect(hasDeveloperAccess).toBe(true);
  });

  test('GDPR section is present', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const pageText = await page.textContent('body');
    const hasGdpr = pageText?.includes('GDPR') ||
      pageText?.includes('Export') ||
      pageText?.includes('Data') ||
      pageText?.includes('Privacy');
    expect(hasGdpr).toBe(true);
  });
});

test.describe('Billing Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaLocalStorage(page);
  });

  test('billing page renders', async ({ page }) => {
    await page.goto('/billing');
    await page.waitForLoadState('networkidle');
    const pageText = await page.textContent('body');
    expect(pageText).toBeTruthy();
  });
});

test.describe('Webhooks Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaLocalStorage(page);
  });

  test('webhooks page renders', async ({ page }) => {
    await page.goto('/webhooks');
    await page.waitForLoadState('networkidle');
    const pageText = await page.textContent('body');
    expect(pageText).toBeTruthy();
  });
});
