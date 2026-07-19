import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		// The command runs a full build first, which can take well over the 60s default.
		timeout: 240_000,
		reuseExistingServer: !process.env.CI
	},
	testMatch: '**/*.e2e.{ts,js}'
});
