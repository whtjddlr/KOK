import { defineConfig } from '@playwright/test';

const port = Number(process.env.PORT ?? 5174);
const host = '127.0.0.1';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://${host}:${port}`;

export default defineConfig({
  testDir: './tests/ui',
  timeout: 35_000,
  expect: {
    timeout: 6_000,
  },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --host ${host} --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'mobile-390',
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'mobile-504',
      use: {
        viewport: { width: 504, height: 978 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      use: {
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
});
