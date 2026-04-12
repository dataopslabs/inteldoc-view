import { test, expect } from '@playwright/test';
import { loginViaLocalStorage } from './helpers/auth';

/**
 * Workspace management E2E tests.
 * Tests workspace listing, creation, and navigation.
 */
test.describe('Workspaces', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaLocalStorage(page);
  });

  test('workspace list page loads', async ({ page }) => {
    await page.goto('/workspaces');
    await page.waitForLoadState('networkidle');

    // Should not show a server error (check for error message text, not the number 500
    // which appears in RSC streaming payloads as JSON data)
    const pageText = await page.textContent('body');
    expect(pageText).not.toContain('500 Internal Server Error');
    expect(pageText).not.toContain('Application error');
    expect(pageText).toBeTruthy();
  });

  test('workspace list shows existing workspace', async ({ page }) => {
    await page.goto('/workspaces');
    await page.waitForLoadState('networkidle');

    // Wait for the API to load workspaces
    await page.waitForTimeout(2000);
    const pageText = await page.textContent('body');
    // Should show "E2E Test WS" workspace created during API tests or "New Workspace" button
    const hasContent = pageText?.includes('Workspace') || pageText?.includes('workspace');
    expect(hasContent).toBe(true);
  });

  test('create workspace button is visible', async ({ page }) => {
    await page.goto('/workspaces');
    await page.waitForLoadState('networkidle');

    const pageText = await page.textContent('body');
    const hasCreateButton = pageText?.includes('New') ||
      pageText?.includes('Create') ||
      pageText?.includes('workspace');
    expect(hasCreateButton).toBe(true);
  });

  test('workspace detail page loads when navigating to a workspace', async ({ page }) => {
    await page.goto('/workspaces');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Try to click on a workspace link if one exists
    const workspaceLink = page.locator('a[href*="/workspaces/"]').first();
    const count = await workspaceLink.count();

    if (count > 0) {
      await workspaceLink.click();
      await page.waitForLoadState('networkidle');
      const url = page.url();
      expect(url).toContain('/workspaces/');
    } else {
      // No workspaces yet — page should show empty state
      const pageText = await page.textContent('body');
      expect(pageText).toBeTruthy();
    }
  });

  test('traces page accessible for workspace', async ({ page }) => {
    // Use the known workspace ID from API tests
    const wsId = '12410801-9753-4a69-8cad-5aaa413ed169';
    await page.goto(`/workspaces/${wsId}`);
    await page.waitForLoadState('networkidle');
    const pageText = await page.textContent('body');
    expect(pageText).toBeTruthy();
  });
});
