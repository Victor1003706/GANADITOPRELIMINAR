import { defineConfig, devices } from '@playwright/test';

const httpPolling = process.env.E2E_HTTP_POLLING === 'true';
const port = Number(process.env.E2E_PORT || (httpPolling ? 4174 : 4173));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('E2E_PORT must be an unprivileged TCP port.');

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  testIgnore: ['real/**'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: [['list'], ['html', { open: 'never', outputFolder: `../../playwright-report/${httpPolling ? 'http' : 'fixtures'}` }]],
  outputDir: `../../test-results/${httpPolling ? 'http' : 'fixtures'}`,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev:web -- --host 127.0.0.1 --port ${port} --strictPort`,
    env: { PUBLIC_LIVE_AUCTIONS_ENABLED: httpPolling ? '' : 'true' },
    cwd: '../..',
    url: `http://127.0.0.1:${port}/acceso`,
    reuseExistingServer: false,
    timeout: 60_000
  }
});
