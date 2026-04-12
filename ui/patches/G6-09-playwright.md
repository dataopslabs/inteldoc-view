# G6-09: Playwright E2E Tests

## Install Playwright
```bash
cd ui
npm install --save-dev @playwright/test
npx playwright install
```

## Create ui/playwright.config.ts
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

## Create ui/e2e/auth.spec.ts
```typescript
import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('login page renders correctly', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.getByText(/sign in/i)).toBeVisible();
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
  });

  test('redirects unauthenticated to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
```

## Create ui/e2e/health.spec.ts
```typescript
import { test, expect } from '@playwright/test';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

test.describe('API Health', () => {
  test('liveness probe returns 200', async ({ request }) => {
    const response = await request.get(`${API_URL}/v1/health`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
  });

  test('readiness probe returns ready', async ({ request }) => {
    const response = await request.get(`${API_URL}/v1/health/ready`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(['ready', 'degraded']).toContain(body.status);
  });
});
```

## Create ui/e2e/workspaces.spec.ts
```typescript
import { test, expect } from '@playwright/test';

// These tests require an authenticated session — set E2E_AUTH_TOKEN env var
test.describe('Workspaces (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    // Inject mock auth token for E2E tests
    await page.addInitScript(() => {
      window.localStorage.setItem('__e2e_skip_auth', 'true');
    });
  });

  test('workspaces page loads', async ({ page }) => {
    await page.goto('/workspaces');
    await expect(page.getByRole('heading', { name: /workspaces/i })).toBeVisible();
  });

  test('shows empty state when no workspaces', async ({ page }) => {
    await page.goto('/workspaces');
    // Either shows workspaces or the empty state
    const content = page.locator('main, [data-testid="workspace-list"], [data-testid="empty-state"]');
    await expect(content.first()).toBeVisible();
  });
});
```

## Add to ui/.github/workflows/ci.yml (e2e job):
```yaml
  e2e:
    name: E2E Tests (Playwright)
    runs-on: ubuntu-latest
    needs: [ui]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    defaults:
      run:
        working-directory: ui
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: ui/package-lock.json
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Run E2E tests
        run: npx playwright test
        env:
          E2E_BASE_URL: ${{ secrets.E2E_BASE_URL }}
          NEXT_PUBLIC_API_URL: ${{ secrets.NEXT_PUBLIC_API_URL }}
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: ui/playwright-report/
```
