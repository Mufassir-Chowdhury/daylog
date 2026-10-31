import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ClaudeSettings from './ClaudeSettings.svelte';

const bridge = vi.hoisted(() => ({
	platform: 'darwin',
	mcpStatus: vi.fn(),
	setMcp: vi.fn()
}));
vi.mock('$lib/desktop', () => ({ desktop: bridge }));

const EXE = '/Applications/daylog.app/Contents/MacOS/daylog';
const off = { enabled: false, exe: EXE, url: 'http://127.0.0.1:47615/mcp', dev: false };

beforeEach(() => {
	bridge.platform = 'darwin';
	bridge.mcpStatus.mockReset().mockResolvedValue(off);
	bridge.setMcp.mockReset().mockImplementation(async (enabled: boolean) => ({ ...off, enabled }));
});

describe('ClaudeSettings', () => {
	it('is off until switched on, then shows how to add it to Claude', async () => {
		const screen = render(ClaudeSettings);
		const toggle = screen.getByLabelText('Let Claude use daylog on this computer');
		await expect.element(toggle).not.toBeChecked();
		await expect.element(screen.getByText('Claude Code', { exact: true })).not.toBeInTheDocument();

		await toggle.click();
		expect(bridge.setMcp).toHaveBeenCalledWith(true);
		await expect
			.element(screen.getByText(/"command": "\/Applications\/daylog\.app/))
			.toBeInTheDocument();
		await expect.element(screen.getByText(/"--mcp"/)).toBeInTheDocument();
		await expect
			.element(screen.getByText(`claude mcp add --scope user daylog -- "${EXE}" --mcp`))
			.toBeInTheDocument();
		await expect
			.element(
				screen.getByText(/Library\/Application Support\/Claude\/claude_desktop_config\.json/)
			)
			.toBeInTheDocument();
	});

	it('offers only Claude Code on Linux', async () => {
		bridge.platform = 'linux';
		bridge.mcpStatus.mockResolvedValue({ ...off, enabled: true });
		const screen = render(ClaudeSettings);
		await expect.element(screen.getByText(/isn't made for Linux/)).toBeInTheDocument();
		await expect
			.element(screen.getByText('Claude Desktop', { exact: true }))
			.not.toBeInTheDocument();
	});
});
