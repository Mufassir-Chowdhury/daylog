<script lang="ts">
	import { session } from '$lib/auth.svelte';
	import { appendToDay } from '$lib/capture';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import { desktop, type CaptureEntry } from '$lib/desktop';
	import { dateKey } from '$lib/date';
	import { dayHref, go } from '$lib/nav';
	import { cancelListening, refreshVoice } from '$lib/ai/voice.svelte';

	// The desktop quick bar: a frameless, always-on-top window that stays loaded
	// while hidden, so the hotkey shows it instantly. Each open bumps `epoch`,
	// which resets the palette and refreshes its people and notes.
	let epoch = $state(0);
	let query = $state('');
	let hideTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() =>
		desktop?.onQuickOpen(() => {
			clearTimeout(hideTimer);
			query = '';
			epoch++;
			// A key added in Settings since the last open turns the mic on.
			refreshVoice();
		})
	);

	function close() {
		clearTimeout(hideTimer);
		// Hidden while listening: let go of the microphone.
		cancelListening();
		desktop?.quickHide();
	}

	function navigate(route: string) {
		if (desktop) desktop.quickNavigate(route);
		else go(route);
	}

	// Questions go to the assistant in the main window, which opens on today's page; a spoken
	// one is answered aloud there.
	function ask(question: string, spoken = false) {
		navigate(
			`${dayHref(dateKey())}?ask=${encodeURIComponent(question)}${spoken ? '&spoken=1' : ''}`
		);
	}

	// The main window does the write (it may have that day open), then the bar
	// gets out of the way once the confirmation has registered.
	async function capture(entry: CaptureEntry) {
		if (desktop) desktop.quickCapture(entry);
		else await appendToDay(session.user!.uid, entry);
		clearTimeout(hideTimer);
		hideTimer = setTimeout(close, 650);
	}
</script>

<svelte:head>
	<title>daylog · quick bar</title>
</svelte:head>

<!-- The window is transparent around the panel; clicking that margin dismisses it. -->
<div
	class="flex h-screen flex-col p-4"
	role="presentation"
	onclick={(e) => e.target === e.currentTarget && close()}
>
	{#if session.user}
		<CommandPalette
			uid={session.user.uid}
			quick
			{epoch}
			bind:query
			{navigate}
			{capture}
			{ask}
			voiceInput
			assistantName="the assistant"
			{close}
		/>
	{:else}
		<div
			class="palette-panel palette-quick flex flex-col items-center justify-center gap-3 rounded-card border border-line bg-card p-8 text-center"
		>
			<span class="palette-orb" aria-hidden="true"></span>
			<p class="text-sm text-mute">Sign in to daylog to use the quick bar.</p>
			<button
				type="button"
				onclick={() => navigate('/')}
				class="rounded-ctl bg-accent-fill px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
			>
				Open daylog
			</button>
		</div>
	{/if}
</div>
