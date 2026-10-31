<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { logOut, session } from '$lib/auth.svelte';
	import { startActivitySync } from '$lib/activity-sync';
	import { assistant, closeAssistant, openAssistant } from '$lib/ai/assistant.svelte';
	import { startInbox } from '$lib/ai/inbox.svelte';
	import { startLease } from '$lib/ai/lease.svelte';
	import { notifyAbout, runBackgroundWork, runCapture } from '$lib/ai/engine';
	import { captureCandidates } from '$lib/ai/capture';
	import { appendToDay } from '$lib/capture';
	import AssistantPanel from '$lib/components/AssistantPanel.svelte';
	import CaptionButtons from '$lib/components/CaptionButtons.svelte';
	import CommandPalette, { type PaletteAction } from '$lib/components/CommandPalette.svelte';
	import DesktopShell from '$lib/components/DesktopShell.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Login from '$lib/components/Login.svelte';
	import Toaster from '$lib/components/Toaster.svelte';
	import { humanDate, relativeLabel } from '$lib/date';
	import { saveSettings } from '$lib/db';
	import { desktop, prettyAccelerator, type DesktopPrefs } from '$lib/desktop';
	import { go, NAV } from '$lib/nav';
	import { closePalette, openPalette, palette } from '$lib/palette.svelte';
	import { syncReminders } from '$lib/reminders';
	import {
		counterpartTheme,
		device,
		effectiveTheme,
		loadDeviceTheme,
		setDeviceTheme,
		settings
	} from '$lib/settings.svelte';
	import { saveFailed, toast } from '$lib/toast.svelte';

	let { children } = $props();

	// The desktop app gets its own look by default; the web app follows the account theme.
	loadDeviceTheme(desktop ? 'jarvis-dark' : 'account');

	const isQuick = $derived(page.route.id === '/quick');
	// Pages that render without the app shell or the sign-in gate.
	const isBare = $derived(isQuick || page.route.id === '/desktop-auth');

	// Theme lives on <html> so every layer (including scrollbars via
	// color-scheme) follows it; localStorage lets app.html restore it pre-paint.
	$effect(() => {
		const theme = effectiveTheme();
		document.documentElement.dataset.theme = theme;
		try {
			localStorage.setItem('daylog-theme', theme);
		} catch {
			/* private mode — theme still applies for the session */
		}
		// Match the native caption buttons to the title bar.
		if (desktop) {
			const css = getComputedStyle(document.documentElement);
			desktop.setTitleBarColors(
				css.getPropertyValue('--t-chrome').trim() || '#0a1120',
				css.getPropertyValue('--t-chrome-ink').trim() || '#c9d8f5'
			);
		}
	});

	if (desktop) document.documentElement.dataset.desktop = '';

	const isActive = (match: string) => page.url.pathname.startsWith(match);

	// ——— Desktop wiring: navigation and captures from the tray / quick bar, reminders.
	let desktopPrefs = $state<DesktopPrefs | null>(null);

	$effect(() => {
		const uid = session.user?.uid;
		if (!desktop || !uid || isQuick) return;
		desktop.getPrefs().then((p) => (desktopPrefs = p));
		const sync = () => syncReminders(uid).catch(() => {});
		sync();
		const timer = setInterval(sync, 60_000);
		const stopActivitySync = startActivitySync(uid);
		const offNavigate = desktop.onNavigate((route) => {
			closePalette();
			go(route === '/' ? NAV[0].href() : route);
		});
		const offCapture = desktop.onCapture((entry) => {
			appendToDay(uid, entry)
				.then(() => {
					toast(`Added to ${relativeLabel(entry.date) || humanDate(entry.date)}`);
					sync();
					structure(uid, entry);
				})
				.catch(saveFailed);
		});
		return () => {
			clearInterval(timer);
			stopActivitySync();
			offNavigate();
			offCapture();
		};
	});

	// ——— Assistant: the Inbox stays live while signed in (not in the quick bar), and this
	// window competes for the lease to look after check-ins (the desktop app wins). While it
	// holds the lease it does the assistant's background work every minute (engine.ts).
	$effect(() => {
		const uid = session.user?.uid;
		if (!uid || isQuick) return;
		const displayName = session.user?.displayName ?? null;
		const stopInbox = startInbox(uid);
		const stopLease = startLease(uid, {
			kind: desktop ? 'desktop' : 'web',
			// The desktop app wakes the window every minute, even hidden in the tray.
			ticks: desktop?.onAssistantTick,
			onHeld: () =>
				runBackgroundWork(uid, displayName)
					.then((cards) => {
						if (!cards.length) return;
						notifyAbout(uid, cards).catch(() => {});
						const brief = cards.find((c) => c.kind === 'brief');
						toast(
							brief && cards.length === 1
								? `${brief.title} is waiting on today's page.`
								: `${cards.length} new in your Inbox on today's page.`,
							{ from: assistant.name, duration: 8000 }
						);
					})
					// Failed runs are recorded and retried.
					.catch(() => {})
		});
		return () => {
			stopInbox();
			stopLease();
		};
	});

	// ——— Assistant: a question handed over in the URL (`?ask=`, from the quick bar) opens it.
	$effect(() => {
		const question = page.url.searchParams.get('ask');
		if (!question || !session.user) return;
		const url = new URL(page.url);
		url.searchParams.delete('ask');
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, only the query changes
		goto(`${url.pathname}${url.search}`, { replaceState: true, noScroll: true, keepFocus: true });
		openAssistant(question);
	});

	function askFromPalette(question: string) {
		closePalette();
		openAssistant(question);
	}

	// ——— Command palette
	async function captureFromPalette(entry: { date: string; line: string }) {
		await appendToDay(session.user!.uid, entry).catch((e) => {
			saveFailed();
			throw e;
		});
		if (desktop) syncReminders(session.user!.uid).catch(() => {});
		structure(session.user!.uid, entry);
	}

	/** A captured line that looks like money, a date or a cancellation becomes a card (capture.ts). */
	function structure(uid: string, entry: { date: string; line: string }) {
		const candidates = captureCandidates(entry.line);
		if (!candidates.length) return;
		runCapture(uid, session.user?.displayName ?? null, entry.date, candidates)
			.then((cards) => {
				if (cards.length)
					toast(
						`${cards.length === 1 ? cards[0].title : `${cards.length} suggestions`} — on ${relativeLabel(entry.date) || humanDate(entry.date)}'s page.`,
						{ from: assistant.name, duration: 8000 }
					);
			})
			.catch(() => {});
	}

	function toggleTheme() {
		if (device.theme !== 'account') {
			setDeviceTheme(counterpartTheme(device.theme));
			return;
		}
		settings.theme = counterpartTheme(settings.theme);
		saveSettings(session.user!.uid, settings).catch(saveFailed);
	}

	const paletteActions: PaletteAction[] = [
		{
			id: 'assistant',
			label: 'Ask the assistant',
			icon: 'sparkle',
			hint: 'Ctrl J',
			keywords: 'jarvis ai chat question help',
			run: () => {
				closePalette();
				openAssistant();
			}
		},
		{
			id: 'theme',
			label: 'Toggle light / dark',
			icon: 'moon',
			keywords: 'theme dark mode light mode appearance',
			run: () => {
				closePalette();
				toggleTheme();
			}
		},
		{
			id: 'print',
			label: 'Print schedule',
			icon: 'schedule',
			keywords: 'pdf routine',
			run: () => {
				closePalette();
				go(resolve('/schedule')).then(() => setTimeout(() => window.print(), 300));
			}
		},
		{
			id: 'help',
			label: 'Keyboard shortcuts',
			icon: 'keyboard',
			hint: '?',
			keywords: 'help keys',
			run: () => {
				closePalette();
				helpOpen = true;
			}
		},
		...(desktop
			? [
					{
						id: 'hide',
						label: 'Hide to tray',
						icon: 'chevronLeft',
						keywords: 'minimize close window',
						run: () => {
							closePalette();
							desktop!.hide();
						}
					} satisfies PaletteAction
				]
			: []),
		{
			id: 'signout',
			label: 'Sign out',
			icon: 'logout',
			keywords: 'log out',
			run: () => {
				closePalette();
				logOut();
			}
		}
	];

	function paletteNavigate(route: string) {
		closePalette();
		go(route);
	}

	// ——— Keyboard shortcuts: Ctrl+K palette, Alt+1…8 pages, "g" then a letter, "?" help.
	let leader = false;
	let leaderTimer: ReturnType<typeof setTimeout> | undefined;
	let helpOpen = $state(false);

	function typing(target: EventTarget | null): boolean {
		const el = target as HTMLElement | null;
		return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
	}

	function onkeydown(e: KeyboardEvent) {
		if (!session.user || isBare) return;
		const ctrl = e.ctrlKey || e.metaKey;
		// These work even while typing — they're the fast lane.
		if (ctrl && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			if (palette.open) closePalette();
			else openPalette();
			return;
		}
		if (ctrl && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'j') {
			e.preventDefault();
			if (assistant.open) closeAssistant();
			else {
				closePalette();
				openAssistant();
			}
			return;
		}
		if (e.altKey && !ctrl && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
			const item = NAV[Number(e.code.slice(5)) - 1];
			if (item) {
				e.preventDefault();
				go(item.href());
			}
			return;
		}
		if (ctrl || e.altKey || typing(e.target)) return;
		if (leader) {
			leader = false;
			clearTimeout(leaderTimer);
			const item = NAV.find((n) => n.key === e.key.toLowerCase());
			if (item) {
				e.preventDefault();
				go(item.href());
			}
			return;
		}
		if (e.key === 'g') {
			leader = true;
			leaderTimer = setTimeout(() => (leader = false), 1200);
		} else if (e.key === '/') {
			e.preventDefault();
			openPalette();
		} else if (e.key === '?') {
			e.preventDefault();
			helpOpen = !helpOpen;
		}
	}

	function showModal(node: HTMLDialogElement) {
		node.showModal();
		return () => node.close();
	}

	const SHORTCUTS: [string[], string][] = $derived([
		[['Ctrl', 'K'], 'Command palette — search, jump, capture'],
		[['/'], 'Command palette (when not typing)'],
		[['Ctrl', 'J'], `Ask ${assistant.name}`],
		[['Ctrl', 'K', '?'], `Ask ${assistant.name} from the palette`],
		...NAV.map((n, i): [string[], string] => [['Alt', String(i + 1)], `Go to ${n.label}`]),
		...NAV.map((n): [string[], string] => [['g', n.key], `Go to ${n.label}`]),
		[['Alt', '←'], 'Previous day (on a day page)'],
		[['Alt', '→'], 'Next day'],
		[['Alt', 'T'], 'Jump to today'],
		[['Ctrl', 'Enter'], 'Cross out the current line (in the editor)'],
		...(desktop
			? ([
					[['Ctrl', 'B'], 'Collapse / expand the sidebar'],
					[
						desktopPrefs ? prettyAccelerator(desktopPrefs.quickKey).split(' + ') : [],
						'Quick bar, from any app'
					],
					[
						desktopPrefs ? prettyAccelerator(desktopPrefs.summonKey).split(' + ') : [],
						'Show / hide daylog, from any app'
					]
				] as [string[], string][])
			: []),
		[['?'], 'Show / hide this list']
	]);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>daylog</title>
</svelte:head>

<svelte:window {onkeydown} />

{#if !session.ready}
	<div class="flex min-h-screen items-center justify-center text-faint">loading…</div>
{:else if isBare}
	{@render children()}
{:else if !session.user}
	{#if desktop}<div class="desk-titlebar fixed inset-x-0 top-0 h-10"></div>{/if}
	<Login />
{:else}
	{#if desktop}
		<DesktopShell
			email={session.user.email}
			prefs={desktopPrefs}
			onpalette={() => openPalette()}
			onassistant={() => openAssistant()}
			onhelp={() => (helpOpen = true)}
			onsignout={() => logOut()}
		>
			{@render children()}
		</DesktopShell>
	{:else}
		<div class="min-h-screen">
			<header
				class="sticky top-0 z-40 border-b border-line bg-card/85 shadow-card backdrop-blur-md print:hidden"
			>
				<nav class="flex w-full items-center gap-x-1 px-4 py-3 sm:px-6 lg:px-10">
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- NAV hrefs come from resolve() -->
					<a href={NAV[0].href()} class="mr-2 flex shrink-0 items-center gap-2.5 sm:mr-4">
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
					<div
						class="-my-1 no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1"
					>
						{#each NAV as item (item.label)}
							<!-- eslint-disable svelte/no-navigation-without-resolve -- NAV hrefs come from resolve() -->
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
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						{/each}
					</div>
					<div class="ml-2 flex shrink-0 items-center gap-1">
						<button
							type="button"
							onclick={() => openPalette()}
							title="Command palette (Ctrl+K)"
							aria-label="Command palette"
							class="flex items-center gap-2 rounded-ctl border border-line px-2.5 py-1.5 text-sm text-faint hover:bg-tint hover:text-ink"
						>
							<span aria-hidden="true">⌕</span>
							<kbd class="hidden text-[11px] sm:inline">Ctrl K</kbd>
						</button>
						<button
							type="button"
							onclick={() => openAssistant()}
							title="{assistant.name} (Ctrl+J)"
							aria-label={assistant.name}
							class="flex items-center gap-1.5 rounded-ctl px-2.5 py-1.5 text-sm text-mute hover:bg-tint hover:text-ink"
						>
							<Icon name="sparkle" size={16} />
							<span class="hidden md:inline">{assistant.name}</span>
						</button>
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
			<main class="w-full px-4 py-6 sm:px-6 lg:px-10 lg:py-8 print:p-0">
				{@render children()}
			</main>
		</div>
	{/if}
	<Toaster />

	{#if palette.open}
		<dialog
			{@attach showModal}
			onclose={closePalette}
			onclick={(e) => e.target === e.currentTarget && closePalette()}
			aria-label="Command palette"
			class="m-0 mx-auto mt-[12vh] h-[min(560px,72vh)] max-h-none w-[calc(100%-2rem)] max-w-2xl overflow-visible bg-transparent p-0 backdrop:bg-black/45 backdrop:backdrop-blur-[3px]"
		>
			<CommandPalette
				uid={session.user.uid}
				bind:query={palette.query}
				actions={paletteActions}
				navigate={paletteNavigate}
				capture={captureFromPalette}
				ask={askFromPalette}
				assistantName={assistant.name}
				close={closePalette}
			/>
		</dialog>
	{/if}

	{#if assistant.open}
		<AssistantPanel />
	{/if}

	{#if helpOpen}
		<dialog
			{@attach showModal}
			onclose={() => (helpOpen = false)}
			onclick={(e) => e.target === e.currentTarget && (helpOpen = false)}
			class="m-auto max-h-[85vh] w-full max-w-md overflow-y-auto rounded-card border border-line bg-card p-0 text-ink shadow-2xl backdrop:bg-black/40"
		>
			<div class="p-5">
				<h2 class="mb-3 font-display text-lg font-bold">Keyboard shortcuts</h2>
				<dl class="space-y-1.5 text-sm">
					{#each SHORTCUTS as [keys, label], i (i)}
						<div class="flex items-center gap-3">
							<dt class="flex w-36 shrink-0 flex-wrap gap-1">
								{#each keys as k, j (j)}<kbd>{k}</kbd>{/each}
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

{#if desktop?.captionButtons && session.ready && !isBare}<CaptionButtons />{/if}
