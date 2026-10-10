<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { logOut, session } from '$lib/auth.svelte';
	import Login from '$lib/components/Login.svelte';
	import Toaster from '$lib/components/Toaster.svelte';
	import { dateKey } from '$lib/date';
	import { settings } from '$lib/settings.svelte';

	let { children } = $props();

	const today = () => resolve('/day/[date]', { date: dateKey() });

	// Theme lives on <html> so every layer (including scrollbars via
	// color-scheme) follows it; localStorage lets app.html restore it pre-paint.
	$effect(() => {
		document.documentElement.dataset.theme = settings.theme;
		try {
			localStorage.setItem('daylog-theme', settings.theme);
		} catch {
			/* private mode — theme still applies for the session */
		}
	});

	const NAV = [
		{ label: 'Today', href: today, match: '/day', key: 'd' },
		{ label: 'People', href: () => resolve('/people'), match: '/people', key: 'p' },
		{ label: 'Notes', href: () => resolve('/notes'), match: '/notes', key: 'n' },
		{ label: 'Routines', href: () => resolve('/routines'), match: '/routines', key: 'r' },
		{ label: 'Finance', href: () => resolve('/finance'), match: '/finance', key: 'f' },
		{ label: 'Settings', href: () => resolve('/settings'), match: '/settings', key: 's' }
	];

	const isActive = (match: string) => page.url.pathname.startsWith(match);

	// ——— Keyboard shortcuts: "g" then a letter jumps to a page; "?" lists them.
	let leader = false;
	let leaderTimer: ReturnType<typeof setTimeout> | undefined;
	let helpOpen = $state(false);

	function typing(target: EventTarget | null): boolean {
		const el = target as HTMLElement | null;
		return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
	}

	function onkeydown(e: KeyboardEvent) {
		if (!session.user || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
		if (leader) {
			leader = false;
			clearTimeout(leaderTimer);
			const item = NAV.find((n) => n.key === e.key.toLowerCase());
			if (item) {
				e.preventDefault();
				goto(item.href());
			}
			return;
		}
		if (e.key === 'g') {
			leader = true;
			leaderTimer = setTimeout(() => (leader = false), 1200);
		} else if (e.key === '?') {
			e.preventDefault();
			helpOpen = !helpOpen;
		}
	}

	function showModal(node: HTMLDialogElement) {
		node.showModal();
		return () => node.close();
	}

	const SHORTCUTS: [string[], string][] = [
		...NAV.map((n): [string[], string] => [['g', n.key], `Go to ${n.label}`]),
		[['Alt', '←'], 'Previous day (on a day page)'],
		[['Alt', '→'], 'Next day'],
		[['Alt', 'T'], 'Jump to today'],
		[['Ctrl', 'Enter'], 'Cross out the current line (in the editor)'],
		[['?'], 'Show / hide this list']
	];
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>daylog</title>
</svelte:head>

<svelte:window {onkeydown} />

{#if !session.ready}
	<div class="flex min-h-screen items-center justify-center text-faint">loading…</div>
{:else if !session.user}
	<Login />
{:else}
	<div class="min-h-screen">
		<header class="sticky top-0 z-40 border-b border-line bg-card/85 shadow-card backdrop-blur-md">
			<nav class="flex w-full items-center gap-x-1 px-4 py-3 sm:px-6 lg:px-10">
				<a href={today()} class="mr-2 flex shrink-0 items-center gap-2.5 sm:mr-4">
					<span
						class="grid h-8 w-8 shrink-0 place-items-center rounded-ctl bg-accent-fill font-display text-base font-black text-on-accent"
					>
						d
					</span>
					<span class="hidden font-display text-lg font-bold tracking-tight text-ink sm:inline">
						daylog
					</span>
				</a>
				<!-- Scrolls sideways on narrow screens instead of wrapping onto several rows. -->
				<div class="-my-1 no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
					{#each NAV as item (item.label)}
						<a
							href={item.href()}
							aria-current={isActive(item.match) ? 'page' : undefined}
							class="shrink-0 rounded-ctl px-3 py-1.5 text-sm font-medium transition-colors {isActive(
								item.match
							)
								? 'bg-accent/10 text-accent'
								: 'text-mute hover:bg-tint hover:text-ink'}"
						>
							{item.label}
						</a>
					{/each}
				</div>
				<div class="ml-2 flex shrink-0 items-center gap-1">
					<button
						type="button"
						onclick={() => (helpOpen = true)}
						title="Keyboard shortcuts (?)"
						aria-label="Keyboard shortcuts"
						class="hidden rounded-ctl px-2.5 py-1.5 text-sm text-faint hover:bg-tint hover:text-ink sm:block"
					>
						⌨
					</button>
					<button
						type="button"
						onclick={() => logOut()}
						aria-label="Sign out"
						title="Sign out{session.user.email ? ` (${session.user.email})` : ''}"
						class="rounded-ctl border border-line px-2.5 py-1.5 text-sm font-medium text-mute transition-colors hover:bg-tint hover:text-ink"
					>
						<span class="hidden sm:inline">Sign out</span>
						<span class="sm:hidden" aria-hidden="true">⎋</span>
					</button>
				</div>
			</nav>
		</header>
		<main class="w-full px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
			{@render children()}
		</main>
	</div>
	<Toaster />

	{#if helpOpen}
		<dialog
			{@attach showModal}
			onclose={() => (helpOpen = false)}
			onclick={(e) => e.target === e.currentTarget && (helpOpen = false)}
			class="m-auto w-full max-w-md rounded-card border border-line bg-card p-0 text-ink shadow-2xl backdrop:bg-black/40"
		>
			<div class="p-5">
				<h2 class="mb-3 font-display text-lg font-bold">Keyboard shortcuts</h2>
				<dl class="space-y-1.5 text-sm">
					{#each SHORTCUTS as [keys, label] (label)}
						<div class="flex items-center gap-3">
							<dt class="flex w-28 shrink-0 gap-1">
								{#each keys as k, i (i)}<kbd>{k}</kbd>{/each}
							</dt>
							<dd class="text-mute">{label}</dd>
						</div>
					{/each}
				</dl>
				<div class="mt-4 flex justify-end">
					<button
						type="button"
						onclick={() => (helpOpen = false)}
						class="rounded-ctl bg-accent-fill px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
					>
						Got it
					</button>
				</div>
			</div>
		</dialog>
	{/if}
{/if}
