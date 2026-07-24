<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { logOut, session } from '$lib/auth.svelte';
	import Login from '$lib/components/Login.svelte';
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
		{ label: 'Today', href: today, match: '/day' },
		{ label: 'People', href: () => resolve('/people'), match: '/people' },
		{ label: 'Notes', href: () => resolve('/notes'), match: '/notes' },
		{ label: 'Routines', href: () => resolve('/routines'), match: '/routines' },
		{ label: 'Finance', href: () => resolve('/finance'), match: '/finance' },
		{ label: 'Settings', href: () => resolve('/settings'), match: '/settings' }
	];

	const isActive = (match: string) => page.url.pathname.startsWith(match);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>daylog</title>
</svelte:head>

{#if !session.ready}
	<div class="flex min-h-screen items-center justify-center text-faint">loading…</div>
{:else if !session.user}
	<Login />
{:else}
	<div class="min-h-screen">
		<header class="sticky top-0 z-40 border-b border-line bg-card/85 shadow-card backdrop-blur-md">
			<nav class="flex w-full flex-wrap items-center gap-x-1 gap-y-2 px-4 py-3 sm:px-6 lg:px-10">
				<a href={today()} class="mr-4 flex items-center gap-2.5">
					<span
						class="grid h-8 w-8 shrink-0 place-items-center rounded-ctl bg-accent-fill font-display text-base font-black text-on-accent"
					>
						d
					</span>
					<span class="font-display text-lg font-bold tracking-tight text-ink">daylog</span>
				</a>
				<div class="flex flex-wrap items-center gap-1">
					{#each NAV as item (item.label)}
						<a
							href={item.href()}
							class="rounded-ctl px-3 py-1.5 text-sm font-medium transition-colors {isActive(
								item.match
							)
								? 'bg-accent/10 text-accent'
								: 'text-mute hover:bg-tint hover:text-ink'}"
						>
							{item.label}
						</a>
					{/each}
				</div>
				<div class="ml-auto flex items-center gap-2">
					<button
						type="button"
						disabled
						title="Voice input — coming soon"
						class="cursor-not-allowed rounded-ctl px-2 py-1.5 text-faint opacity-60"
						aria-label="Voice input — coming soon"
					>
						🎤
					</button>
					<button
						type="button"
						onclick={() => logOut()}
						class="rounded-ctl border border-line px-3 py-1.5 text-sm font-medium text-mute transition-colors hover:bg-tint hover:text-ink"
					>
						Sign out
					</button>
				</div>
			</nav>
		</header>
		<main class="w-full px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
			{@render children()}
		</main>
	</div>
{/if}
