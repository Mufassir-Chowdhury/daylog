<script lang="ts">
	import { assistant } from '$lib/ai/assistant.svelte';
	import { desktop, type McpStatus } from '$lib/desktop';
	import { toast } from '$lib/toast.svelte';

	let status = $state<McpStatus | null>(null);
	let busy = $state(false);

	desktop
		?.mcpStatus()
		.then((s) => (status = s))
		.catch(() => {});

	async function toggle(enabled: boolean) {
		if (!desktop) return;
		busy = true;
		try {
			status = await desktop.setMcp(enabled);
			if (enabled) toast('Claude can use daylog. Add it to Claude below, then restart Claude.');
		} finally {
			busy = false;
		}
	}

	const desktopConfig = $derived(
		status
			? JSON.stringify(
					{ mcpServers: { daylog: { command: status.exe, args: ['--mcp'] } } },
					null,
					2
				)
			: ''
	);
	const codeCommand = $derived(
		status ? `claude mcp add --scope user daylog -- "${status.exe}" --mcp` : ''
	);
	const configPath = $derived(
		desktop?.platform === 'win32'
			? '%APPDATA%\\Claude\\claude_desktop_config.json'
			: '~/Library/Application Support/Claude/claude_desktop_config.json'
	);

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast('Copied');
		} catch {
			toast('Couldn’t copy — select the text and copy it instead.', { tone: 'error' });
		}
	}

	const check = 'rounded border-line bg-card text-accent-fill';
	const subhead = 'text-sm font-medium text-ink';
	const code =
		'block overflow-x-auto rounded-ctl border border-line bg-canvas px-3 py-2 font-mono text-xs whitespace-pre text-ink';
	const copyButton = 'text-xs font-medium text-accent hover:underline';
</script>

<section class="rounded-card border border-line bg-card p-4 shadow-card">
	<h2 class="mb-3 text-xs font-semibold tracking-wide text-mute uppercase">
		Use daylog from Claude
	</h2>

	<div class="space-y-4">
		<p class="text-sm text-mute">
			Talk to your log from Claude Desktop or Claude Code on your Claude subscription, with no API
			key. Claude gets the same tools as {assistant.name}: small additions happen at once with Undo
			here, other changes wait in your Inbox to apply, and areas switched off under “What it can
			see” stay hidden.
		</p>

		{#if !desktop}
			<p class="text-sm text-faint">
				This goes through the desktop app: turn it on in the desktop app's Settings.
			</p>
		{:else if status}
			<div class="space-y-1">
				<label class="flex items-center gap-2 text-sm text-ink">
					<input
						type="checkbox"
						checked={status.enabled}
						disabled={busy}
						onchange={(e) => toggle(e.currentTarget.checked)}
						class={check}
					/>
					Let Claude use daylog on this computer
				</label>
				<p class="text-xs text-faint">
					daylog has to be running (the tray is enough) and signed in. Turning this off disconnects
					Claude straight away.
				</p>
			</div>

			{#if status.enabled}
				{#if status.dev}
					<p class="text-xs text-amber-600 dark:text-amber-400">
						This is a development build: the path below points at it and changes with the installed
						app.
					</p>
				{/if}

				{#if desktop.platform === 'linux'}
					<p class="text-xs text-faint">
						Claude Desktop isn't made for Linux; use Claude Code below.
					</p>
				{:else}
					<div class="space-y-2">
						<div class="flex items-baseline justify-between gap-2">
							<p class={subhead}>Claude Desktop</p>
							<button type="button" class={copyButton} onclick={() => copy(desktopConfig)}
								>Copy</button
							>
						</div>
						<ol class="list-decimal space-y-1 pl-5 text-xs text-mute">
							<li>In Claude, open Settings → Developer → Edit Config.</li>
							<li>
								Paste this into <code class="font-mono">{configPath}</code>. If the file already has
								<code class="font-mono">mcpServers</code>, add the
								<code class="font-mono">daylog</code> entry inside it.
							</li>
							<li>
								Quit Claude completely and open it again. daylog shows up under the tools button.
							</li>
						</ol>
						<pre class={code}>{desktopConfig}</pre>
					</div>
				{/if}

				<div class="space-y-2">
					<div class="flex items-baseline justify-between gap-2">
						<p class={subhead}>Claude Code</p>
						<button type="button" class={copyButton} onclick={() => copy(codeCommand)}>Copy</button>
					</div>
					<p class="text-xs text-mute">Run this once in a terminal, then check it with /mcp.</p>
					<pre class={code}>{codeCommand}</pre>
				</div>
			{/if}
		{/if}
	</div>
</section>
