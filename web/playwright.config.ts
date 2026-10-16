import { defineConfig } from '@playwright/test';

// Runs against a live op25-tap (it needs real telemetry to be meaningful):
//   BASE_URL=http://localhost:8000 npm run test:e2e
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
  },
});
