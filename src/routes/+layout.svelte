<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { resolve } from '$app/paths';
	import { logOut, session } from '$lib/auth.svelte';
	import Login from '$lib/components/Login.svelte';
	import { dateKey } from '$lib/date';

	let { children } = $props();

	const today = () => resolve('/day/[date]', { date: dateKey() });
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>daylog</title>
</svelte:head>

{#if !session.ready}
	<div class="flex min-h-screen items-center justify-center text-gray-400">loading…</div>
{:else if !session.user}
	<Login />
{:else}
	<div class="min-h-screen bg-gray-50">
		<header class="border-b border-gray-200 bg-white">
			<nav class="mx-auto flex max-w-2xl items-center gap-4 px-4 py-3">
				<a href={today()} class="text-lg font-bold text-gray-900">daylog</a>
				<a href={today()} class="text-sm text-gray-600 hover:text-gray-900">Today</a>
				<a href={resolve('/people')} class="text-sm text-gray-600 hover:text-gray-900">People</a>
				<a href={resolve('/notes')} class="text-sm text-gray-600 hover:text-gray-900">Notes</a>
				<div class="ml-auto flex items-center gap-3">
					<button
						type="button"
						disabled
						title="Voice input — coming soon"
						class="cursor-not-allowed text-gray-300"
						aria-label="Voice input — coming soon"
					>
						🎤
					</button>
					<button
						type="button"
						onclick={() => logOut()}
						class="text-sm text-gray-500 hover:text-gray-900"
					>
						Sign out
					</button>
				</div>
			</nav>
		</header>
		<main class="mx-auto max-w-2xl px-4 py-6">
			{@render children()}
		</main>
	</div>
{/if}
