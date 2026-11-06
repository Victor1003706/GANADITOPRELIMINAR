import { defineConfig, devices } from '@playwright/test';
import { isolatedWebEnvironment } from './environment.mjs';

isolatedWebEnvironment(process.env);

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: '../../../test-results/real',
  use: {
    baseURL: 'http://127.0.0.1:4180',
    timezoneId: 'UTC',
    // Auth requests carry disposable credentials. Never retain network artifacts.
    trace: 'off', video: 'off', screenshot: 'off'
  },
  projects: [{ name: 'chromium-real', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node --import tsx tests/e2e/real/server.mjs',
      cwd: '../../..',
      url: 'http://127.0.0.1:4181/health',
      reuseExistingServer: false,
      timeout: 60_000
    },
    {
      command: 'node tests/e2e/real/web.mjs',
      cwd: '../../..',
      env: {
        PUBLIC_API_URL: '',
        API_INTERNAL_URL: 'http://127.0.0.1:4181',
        PUBLIC_LIVE_AUCTIONS_ENABLED: 'false'
      },
      url: 'http://127.0.0.1:4180/acceso',
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
});
