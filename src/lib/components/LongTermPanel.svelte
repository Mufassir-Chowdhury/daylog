<script lang="ts">
	import { deleteLongTermTask, newLongTermId, saveLongTermTask, type LongTermTask } from '$lib/db';

	let {
		uid,
		date,
		tasks = $bindable()
	}: { uid: string; date: string; tasks: LongTermTask[] } = $props();

	// A task belongs to this day if it existed by then and wasn't crossed out on
	// an earlier day. On the day it was crossed out it stays, struck through, so
	// it can be crossed back in; after that it stops being carried forward.
	const visible = $derived(
		tasks
			.filter((t) => t.createdOn <= date && (t.completedOn === null || t.completedOn >= date))
			.slice()
			.sort((a, b) => a.order - b.order)
	);

	let newText = $state('');
	let addingSubtaskFor: string | null = $state(null);
	let subtaskText = $state('');
	let error = $state(false);

	function update(updated: LongTermTask) {
		tasks = tasks.map((t) => (t.id === updated.id ? updated : t));
		saveLongTermTask(uid, updated).catch(() => (error = true));
	}

	function addTask() {
		const text = newText.trim();
		if (!text) return;
		const task: LongTermTask = {
			id: newLongTermId(uid),
			text,
			order: Math.max(0, ...tasks.map((t) => t.order)) + 1,
			createdOn: date,
			completedOn: null,
			subtasks: []
		};
		newText = '';
		tasks = [...tasks, task];
		saveLongTermTask(uid, task).catch(() => (error = true));
	}

	function toggleTask(task: LongTermTask) {
		update({ ...task, completedOn: task.completedOn === null ? date : null });
	}

	function removeTask(task: LongTermTask) {
		if (!confirm(`Delete "${task.text}" everywhere? It disappears from every day.`)) return;
		tasks = tasks.filter((t) => t.id !== task.id);
		deleteLongTermTask(uid, task.id).catch(() => (error = true));
	}

	/** Swaps priority with the neighbor above (-1) or below (+1) in the visible list. */
	function move(task: LongTermTask, dir: -1 | 1) {
		const i = visible.findIndex((t) => t.id === task.id);
		const other = visible[i + dir];
		if (!other) return;
		const a = { ...task, order: other.order };
		const b = { ...other, order: task.order };
		tasks = tasks.map((t) => (t.id === a.id ? a : t.id === b.id ? b : t));
		saveLongTermTask(uid, a).catch(() => (error = true));
		saveLongTermTask(uid, b).catch(() => (error = true));
	}

	function toggleSubtask(task: LongTermTask, index: number) {
		update({
			...task,
			subtasks: task.subtasks.map((s, i) => (i === index ? { ...s, done: !s.done } : s))
		});
	}

	function removeSubtask(task: LongTermTask, index: number) {
		update({ ...task, subtasks: task.subtasks.filter((_, i) => i !== index) });
	}

	function addSubtask(task: LongTermTask) {
		const text = subtaskText.trim();
		if (!text) return;
		subtaskText = '';
		update({ ...task, subtasks: [...task.subtasks, { text, done: false }] });
	}

	function autofocus(node: HTMLInputElement) {
		node.focus();
	}
</script>

<section class="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
	<h2 class="mb-2 text-xs font-semibold tracking-wide text-indigo-700 uppercase">Long-standing</h2>
	{#if visible.length === 0}
		<p class="text-sm text-gray-400">
			Nothing long-standing — add things you're working towards over many days.
		</p>
	{/if}
	<div class="space-y-2">
		{#each visible as task (task.id)}
			{@const done = task.completedOn !== null}
			{@const doneSubs = task.subtasks.filter((s) => s.done).length}
			<div class="group">
				<p class="flex items-center gap-1.5 leading-relaxed">
					<button
						type="button"
						onclick={() => toggleTask(task)}
						aria-label={done ? 'Cross back in' : 'Cross out'}
						class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none {done
							? 'border-green-300 bg-green-100 text-green-700'
							: 'border-gray-300 bg-white text-transparent hover:text-gray-300'}"
					>
						✓
					</button>
					<span class="text-sm font-medium {done ? 'text-gray-400 line-through' : 'text-gray-800'}">
						{task.text}
					</span>
					{#if task.subtasks.length > 0}
						<span class="text-xs text-gray-400">{doneSubs}/{task.subtasks.length}</span>
					{/if}
					<span
						class="ml-auto flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
					>
						{#if !done}
							<button
								type="button"
								onclick={() => move(task, -1)}
								aria-label="Move up"
								class="rounded px-1 text-xs text-gray-400 hover:bg-indigo-100 hover:text-gray-600"
								>↑</button
							>
							<button
								type="button"
								onclick={() => move(task, 1)}
								aria-label="Move down"
								class="rounded px-1 text-xs text-gray-400 hover:bg-indigo-100 hover:text-gray-600"
								>↓</button
							>
							<button
								type="button"
								onclick={() => {
									addingSubtaskFor = task.id;
									subtaskText = '';
								}}
								aria-label="Add subtask"
								class="rounded px-1 text-xs text-gray-400 hover:bg-indigo-100 hover:text-gray-600"
								>+ sub</button
							>
						{/if}
						<button
							type="button"
							onclick={() => removeTask(task)}
							aria-label="Delete task"
							class="rounded px-1 text-xs text-gray-400 hover:bg-red-100 hover:text-red-600"
							>×</button
						>
					</span>
				</p>
				{#if task.subtasks.length > 0 || addingSubtaskFor === task.id}
					<div class="mt-1 ml-6 space-y-1">
						{#each task.subtasks as subtask, i (i)}
							<p class="group/sub flex items-center gap-1.5 text-sm leading-snug">
								<button
									type="button"
									onclick={() => toggleSubtask(task, i)}
									aria-label={subtask.done ? 'Cross back in' : 'Cross out'}
									class="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[9px] leading-none {subtask.done
										? 'border-green-300 bg-green-100 text-green-700'
										: 'border-gray-300 bg-white text-transparent hover:text-gray-300'}"
								>
									✓
								</button>
								<span class={subtask.done ? 'text-gray-400 line-through' : 'text-gray-700'}>
									{subtask.text}
								</span>
								<button
									type="button"
									onclick={() => removeSubtask(task, i)}
									aria-label="Delete subtask"
									class="rounded px-1 text-xs text-gray-400 opacity-0 group-focus-within/sub:opacity-100 group-hover/sub:opacity-100 hover:bg-red-100 hover:text-red-600"
									>×</button
								>
							</p>
						{/each}
						{#if addingSubtaskFor === task.id}
							<input
								type="text"
								bind:value={subtaskText}
								{@attach autofocus}
								placeholder="Subtask — enter to add, esc to close"
								onkeydown={(e) => {
									if (e.key === 'Enter') addSubtask(task);
									else if (e.key === 'Escape') addingSubtaskFor = null;
								}}
								onblur={() => {
									if (!subtaskText.trim()) addingSubtaskFor = null;
								}}
								class="w-full max-w-xs rounded-lg border-gray-300 px-2 py-1 text-sm"
							/>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
	<form
		class="mt-3"
		onsubmit={(e) => {
			e.preventDefault();
			addTask();
		}}
	>
		<input
			type="text"
			bind:value={newText}
			placeholder="+ Long-standing task (e.g. master's thesis)"
			class="w-full rounded-lg border-gray-300 text-sm"
		/>
	</form>
	{#if error}
		<p class="mt-2 text-xs text-red-500">save failed — some changes may not be stored</p>
	{/if}
</section>
