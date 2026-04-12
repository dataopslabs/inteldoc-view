import { test, expect } from '@playwright/test';
import { loginViaLocalStorage } from './helpers/auth';

/**
 * Navigation & layout tests.
 * Verifies the sidebar, header, and route navigation work correctly.
 */
test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaLocalStorage(page);
  });

  test('dashboard page loads and shows key sections', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Page title
    await expect(page).toHaveTitle(/DocOps/i);

    // Sidebar should be visible
    const sidebar = page.locator('nav, aside, [data-testid="sidebar"]').first();
    await expect(sidebar).toBeVisible({ timeout: 10000 });
  });

  test('sidebar contains main navigation links', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const pageContent = await page.textContent('body');
    // Should have navigation items
    const hasNav = ['Dashboard', 'Workspaces', 'Traces', 'Observability'].some(
      (text) => pageContent?.includes(text)
    );
    expect(hasNav).toBe(true);
  });

  test('navigating to workspaces page', async ({ page }) => {
    await page.goto('/workspaces');
    await page.waitForLoadState('networkidle');
    const url = page.url();
    expect(url).toContain('workspaces');
  });

  test('navigating to observability page', async ({ page }) => {
    await page.goto('/observability');
    await page.waitForLoadState('networkidle');
    const url = page.url();
    expect(url).toContain('observability');
  });

  test('navigating to HITL page', async ({ page }) => {
    await page.goto('/hitl');
    await page.waitForLoadState('networkidle');
    const url = page.url();
    expect(url).toContain('hitl');
  });

  test('navigating to settings page', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    const url = page.url();
    expect(url).toContain('settings');
  });
});
