// Runs the assistant evals (src/lib/ai/evals) against a real provider.
// Usage: ANTHROPIC_API_KEY=… npm run eval:ai   (see run.eval.ts for options)
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['vitest', 'run', '--project', 'eval', ...process.argv.slice(2)], {
	stdio: 'inherit',
	env: { ...process.env, DAYLOG_EVAL: '1' },
	shell: process.platform === 'win32'
});
process.exit(result.status ?? 1);
