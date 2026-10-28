import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
 testDir: './tests/e2e',
 fullyParallel: false,
 use: { baseURL: 'http://127.0.0.1:4174', ...devices['Desktop Chrome'] },
 webServer: {
  command: 'npm run dev --workspace @gather/web -- --host 127.0.0.1 --port 4174 --strictPort',
  url: 'http://127.0.0.1:4174/',
  reuseExistingServer: false,
  env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', VITE_API_URL: '' },
 },
});
