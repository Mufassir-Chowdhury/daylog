<script lang="ts">
	import { desktop } from '$lib/desktop';

	// Minimize / maximize / close for the frameless desktop window, sized and drawn
	// like Windows 11's, in the title bar's colours.
	let maximized = $state(false);

	function refresh() {
		desktop?.isMaximized().then((m) => (maximized = m));
	}

	$effect(refresh);
</script>

<svelte:window onresize={refresh} />

<div class="caption fixed top-0 right-0 z-[60] flex h-10 print:hidden">
	<button type="button" aria-label="Minimize" onclick={() => desktop?.minimize()}>
		<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
			<path d="M0 5.5h10" />
		</svg>
	</button>
	<button
		type="button"
		aria-label={maximized ? 'Restore' : 'Maximize'}
		onclick={() => desktop?.toggleMaximize()}
	>
		<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
			{#if maximized}
				<path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" />
			{:else}
				<path d="M.5.5h9v9h-9z" />
			{/if}
		</svg>
	</button>
	<button type="button" aria-label="Close" class="close" onclick={() => desktop?.hide()}>
		<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
			<path d="M.5.5l9 9M9.5.5l-9 9" />
		</svg>
	</button>
</div>

<style>
	.caption button {
		display: grid;
		place-items: center;
		width: 46px;
		height: 100%;
		color: var(--t-chrome-ink);
		transition: background-color 80ms;
	}
	.caption button:hover {
		background: color-mix(in oklab, var(--t-chrome-ink) 12%, transparent);
	}
	.caption button:active {
		background: color-mix(in oklab, var(--t-chrome-ink) 20%, transparent);
	}
	.caption button.close:hover {
		background: #c42b1c;
		color: #fff;
	}
	.caption button.close:active {
		background: #c84031;
		color: #fff;
	}
	.caption svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1;
		shape-rendering: crispEdges;
	}
	.caption .close svg {
		shape-rendering: geometricPrecision;
	}
</style>
