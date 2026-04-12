import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for DocOps UI.
 * Tests run against the Next.js dev server started automatically.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 30000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
    env: {
      NEXT_PUBLIC_USER_POOL_ID: process.env.NEXT_PUBLIC_USER_POOL_ID ?? 'us-east-1_PM9hFCIfC',
      NEXT_PUBLIC_USER_POOL_CLIENT_ID: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID ?? 'm0ud627mo92vldpq32k6ev44o',
      NEXT_PUBLIC_IDENTITY_POOL_ID: process.env.NEXT_PUBLIC_IDENTITY_POOL_ID ?? 'us-east-1:e700e7bf-519e-4f70-b9a3-edd3fc9e30f0',
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'https://d259da6j0f.execute-api.us-east-1.amazonaws.com/v1/',
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    },
  },
});
