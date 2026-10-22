<script lang="ts">
	import type { ActivityPatch, ActivityStatus } from '$lib/desktop';

	/** Privacy and tracking options for the activity tracker (desktop only). */
	let {
		status,
		update,
		clear
	}: {
		status: ActivityStatus;
		update: (patch: ActivityPatch) => void;
		clear: () => void;
	} = $props();

	const field = 'rounded-ctl border-line bg-card py-1.5 text-sm text-ink';

	function saveExclude(text: string) {
		const list = text
			.split(/[\n,]/)
			.map((x) => x.trim())
			.filter(Boolean);
		if (list.join('\n') !== status.exclude.join('\n')) update({ exclude: list });
	}

	let confirming = $state(false);
</script>

<section class="rounded-card border border-line bg-card p-4 shadow-card">
	<h2 class="mb-3 text-xs font-semibold tracking-wide text-mute uppercase">Tracking & privacy</h2>
	<div class="space-y-4 text-sm">
		<label class="flex items-center gap-2 text-ink">
			<input
				type="checkbox"
				checked={status.enabled}
				onchange={(e) => update({ enabled: e.currentTarget.checked })}
				class="rounded border-line bg-card text-accent-fill"
			/>
			Track which app is in front
		</label>
		<label class="flex items-start gap-2 text-ink">
			<input
				type="checkbox"
				checked={status.titles}
				onchange={(e) => update({ titles: e.currentTarget.checked })}
				class="mt-0.5 rounded border-line bg-card text-accent-fill"
			/>
			<span>
				Record window titles
				<span class="block text-xs text-faint">
					Needed to tell websites apart (YouTube vs GitHub in the same browser) and to show which
					documents took your time. Off: only app names are kept.
				</span>
			</span>
		</label>
		<div class="flex flex-wrap items-center gap-x-6 gap-y-3">
			<label class="flex items-center gap-2 text-mute">
				Stop counting after
				<select
					value={status.idleMinutes}
					onchange={(e) => update({ idleMinutes: Number(e.currentTarget.value) })}
					class={field}
				>
					{#each [2, 3, 5, 10, 15, 30] as m (m)}<option value={m}>{m} min</option>{/each}
				</select>
				without input
			</label>
			<label class="flex items-center gap-2 text-mute">
				Keep history for
				<select
					value={status.retentionDays}
					onchange={(e) => update({ retentionDays: Number(e.currentTarget.value) })}
					class={field}
				>
					{#each [30, 90, 180, 365] as d (d)}<option value={d}>{d} days</option>{/each}
				</select>
			</label>
		</div>
		<label class="block text-mute">
			Never record these apps (app or process names, one per line or comma-separated)
			<textarea
				rows="2"
				value={status.exclude.join('\n')}
				onblur={(e) => saveExclude(e.currentTarget.value)}
				placeholder="KeePass, Banking app"
				class="mt-1 block w-full max-w-md rounded-ctl border-line bg-card text-sm text-ink"
			></textarea>
		</label>
		<p class="text-xs text-faint">
			Activity syncs to your daylog account (window titles too, unless turned off above), so the
			Activity page works on every device; nothing goes anywhere else. Time stops counting when you
			lock the screen or step away — but not while a video or call is playing. History on this
			computer is pruned after the period above; what's synced stays until you delete it.
		</p>
		<div class="flex flex-wrap items-center gap-2">
			{#if confirming}
				<span class="text-ink">Delete all activity, here and in your account (every computer)?</span
				>
				<button
					type="button"
					onclick={() => {
						confirming = false;
						clear();
					}}
					class="rounded-ctl bg-red-600 px-3 py-1.5 font-medium text-white hover:opacity-90"
				>
					Delete everything
				</button>
				<button
					type="button"
					onclick={() => (confirming = false)}
					class="rounded-ctl px-3 py-1.5 text-mute hover:bg-tint hover:text-ink"
				>
					Cancel
				</button>
			{:else}
				<button
					type="button"
					onclick={() => (confirming = true)}
					class="rounded-ctl border border-line px-3 py-1.5 text-mute hover:bg-tint hover:text-ink"
				>
					Delete all activity data…
				</button>
			{/if}
		</div>
	</div>
</section>
