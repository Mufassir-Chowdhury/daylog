import { mdsvex } from 'mdsvex';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import cloudflare from '@sveltejs/adapter-cloudflare';
import staticAdapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

// `vite build --mode desktop` emits a static SPA into desktop/app, which the
// desktop app (src-tauri) embeds and serves locally; every other build targets
// Cloudflare as before.
export default defineConfig(({ mode }) => ({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter:
				mode === 'desktop'
					? staticAdapter({ pages: 'desktop/app', assets: 'desktop/app', fallback: '200.html' })
					: cloudflare(),
			preprocess: [mdsvex({ extensions: ['.svx', '.md'] })],
			extensions: ['.svelte', '.svx', '.md']
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			},

			// The assistant evals call a real provider and cost money: only with `npm run eval:ai`.
			...(process.env.DAYLOG_EVAL
				? [
						{
							extends: './vite.config.ts',
							test: {
								name: 'eval',
								environment: 'node',
								include: ['src/lib/ai/evals/**/*.eval.ts'],
								// One case at a time keeps the report in order and the rate limits happy.
								fileParallelism: false
							}
						}
					]
				: [])
		]
	}
}));
