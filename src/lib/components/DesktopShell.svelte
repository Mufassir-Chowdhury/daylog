<script lang="ts">
	import { page } from '$app/state';
	import { prettyAccelerator, type DesktopPrefs } from '$lib/desktop';
	import { NAV } from '$lib/nav';
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		children,
		email,
		prefs,
		onpalette,
		onhelp,
		onsignout
	}: {
		children: Snippet;
		email: string | null;
		prefs: DesktopPrefs | null;
		onpalette: () => void;
		onhelp: () => void;
		onsignout: () => void;
	} = $props();

	const SIDEBAR_KEY = 'daylog-sidebar-collapsed';

	function loadCollapsed(): boolean {
		try {
			return localStorage.getItem(SIDEBAR_KEY) === '1';
		} catch {
			return false;
		}
	}

	let collapsed = $state(loadCollapsed());

	function toggleSidebar() {
		collapsed = !collapsed;
		try {
			localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
		} catch {
			/* not remembered — harmless */
		}
	}

	const current = $derived(NAV.find((n) => page.url.pathname.startsWith(n.match)));

	// A clock and a connection light in the title bar — the always-on assistant feel.
	let now = $state(new Date());
	let online = $state(navigator.onLine);

	$effect(() => {
		const timer = setInterval(() => (now = new Date()), 10_000);
		return () => clearInterval(timer);
	});

	const time = $derived(now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
	const day = $derived(
		now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
	);

	function onkeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
			e.preventDefault();
			toggleSidebar();
		}
	}
</script>

<svelte:window {onkeydown} ononline={() => (online = true)} onoffline={() => (online = false)} />

<div class="flex h-screen flex-col overflow-hidden">
	<!-- Right padding leaves room for the caption buttons (CaptionButtons.svelte). -->
	<header
		class="desk-titlebar flex h-10 shrink-0 items-center gap-3 border-b border-line pr-[150px] pl-3"
	>
		<button
			type="button"
			onclick={toggleSidebar}
			title="Toggle sidebar (Ctrl+B)"
			aria-label="Toggle sidebar"
			class="grid h-7 w-7 place-items-center rounded-ctl text-faint hover:bg-tint hover:text-ink"
		>
			<Icon name="panel" size={16} />
		</button>
		<span class="flex items-center gap-2">
			<span class="brand-orb" aria-hidden="true"></span>
			<span class="font-display text-sm font-semibold tracking-wide text-ink">daylog</span>
		</span>
		{#if current}
			<span class="text-faint">/</span>
			<span class="text-sm text-mute">{current.label}</span>
		{/if}

		<button
			type="button"
			onclick={onpalette}
			class="desk-search mx-auto flex h-7 w-full max-w-md min-w-0 items-center gap-2 rounded-ctl border border-line px-3 text-xs"
		>
			<Icon name="search" size={14} />
			<span class="truncate">Search, jump to a day, or capture a thought…</span>
			<kbd class="ml-auto">Ctrl K</kbd>
		</button>

		<span class="flex shrink-0 items-center gap-3 text-xs">
			<span
				class="flex items-center gap-1.5 {online ? 'text-faint' : 'text-amber-500'}"
				title={online
					? 'Online — changes sync instantly'
					: 'Offline — changes sync when you reconnect'}
			>
				<Icon name={online ? 'cloud' : 'cloudOff'} size={14} />
				{#if !online}offline{/if}
			</span>
			<span class="hidden text-right leading-tight md:block">
				<span class="block font-medium text-ink tabular-nums">{time}</span>
			</span>
			<span class="hidden text-faint lg:inline">{day}</span>
		</span>
	</header>

	<div class="flex min-h-0 flex-1">
		<aside
			class="desk-sidebar flex shrink-0 flex-col gap-0.5 border-r border-line p-2 transition-[width] duration-150 print:hidden {collapsed
				? 'w-[56px]'
				: 'w-[212px]'}"
		>
			<nav class="flex flex-col gap-0.5 pl-2">
				{#each NAV as item, i (item.label)}
					<!-- eslint-disable svelte/no-navigation-without-resolve -- NAV hrefs come from resolve() -->
					<a
						href={item.href()}
						aria-current={current === item ? 'page' : undefined}
						title={collapsed ? `${item.label} (Alt+${i + 1})` : undefined}
						class="desk-nav group flex h-9 items-center gap-3 rounded-ctl px-2.5 text-sm font-medium"
					>
						<Icon name={item.icon} size={17} />
						{#if !collapsed}
							<span class="flex-1 truncate">{item.label}</span>
							<kbd class="opacity-0 transition-opacity group-hover:opacity-100">Alt {i + 1}</kbd>
						{/if}
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/each}
			</nav>

			<div class="mt-auto flex flex-col gap-0.5 pl-2">
				{#if !collapsed && prefs}
					<div
						class="mb-2 rounded-ctl border border-line p-2.5 text-[11px] leading-relaxed text-faint"
					>
						<div class="mb-1 flex items-center gap-1.5 font-medium text-mute">
							<Icon name="bolt" size={13} class="text-accent" /> From any app
						</div>
						<div><kbd>{prettyAccelerator(prefs.quickKey)}</kbd> quick bar</div>
						<div class="mt-1"><kbd>{prettyAccelerator(prefs.summonKey)}</kbd> show / hide</div>
					</div>
				{/if}
				<button
					type="button"
					onclick={onhelp}
					title="Keyboard shortcuts (?)"
					class="desk-nav flex h-9 items-center gap-3 rounded-ctl px-2.5 text-sm"
				>
					<Icon name="keyboard" size={17} />
					{#if !collapsed}<span>Shortcuts</span>{/if}
				</button>
				<button
					type="button"
					onclick={onsignout}
					title="Sign out{email ? ` (${email})` : ''}"
					class="desk-nav flex h-9 items-center gap-3 rounded-ctl px-2.5 text-sm"
				>
					<Icon name="logout" size={17} />
					{#if !collapsed}<span class="truncate">Sign out</span>{/if}
				</button>
			</div>
		</aside>

		<main
			class="min-w-0 flex-1 overflow-y-auto px-4 py-6 [--sticky-top:0px] sm:px-6 lg:px-10 lg:py-8"
		>
			{@render children()}
		</main>
	</div>
</div>
