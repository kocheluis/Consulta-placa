import { defineConfig, devices } from '@playwright/test';

/**
 * Config e2e. Levanta la web (next dev) y mockea la API vía page.route, por lo
 * que NO requiere el backend ni los portales reales. Ejecutar: `npm run test:e2e`.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
