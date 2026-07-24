<script lang="ts">
	import { tick } from 'svelte';
	import type { Person } from '$lib/db';
	import { highlightLine, isValidHandle, toggleDone, type HighlightedLine } from '$lib/parse';

	let {
		value = $bindable(''),
		people,
		placeholder = '',
		oninput,
		onnewperson
	}: {
		value?: string;
		people: Person[];
		placeholder?: string;
		/** Called after any edit (typing or picking a suggestion). */
		oninput?: () => void;
		/** Called when a typed mention is committed (space/enter) and isn't a known person. */
		onnewperson?: (handle: string) => void;
	} = $props();

	let textareaEl: HTMLTextAreaElement | undefined = $state();
	let backdropEl: HTMLDivElement | undefined = $state();

	/** The `@mention` currently being typed at the caret, if any. */
	let ctx: { start: number; query: string } | null = $state(null);
	/** Start index of a context dismissed with Escape — stays closed until the `@` changes. */
	let dismissedAt: number | null = $state(null);
	let selected = $state(0);
	let dropdownPos = $state({ left: 0, top: 0 });

	const active = $derived.by(() => {
		const c = ctx;
		return c !== null && dismissedAt !== c.start;
	});

	// Per-line highlight segments; the trailing newline keeps the backdrop's
	// height in sync when the text ends with an empty line.
	const highlighted = $derived.by(() => {
		const lines = value.split('\n');
		return lines.map((line, i): HighlightedLine & { newline: string } => ({
			...highlightLine(line),
			newline: i < lines.length - 1 ? '\n' : '\n\n'
		}));
	});

	const suggestions = $derived.by(() => {
		if (!ctx) return [];
		const q = ctx.query.toLowerCase();
		const starts = people.filter((p) => p.handle.startsWith(q));
		const rest = people.filter(
			(p) =>
				!p.handle.startsWith(q) &&
				(p.handle.includes(q) || (p.name ?? '').toLowerCase().includes(q))
		);
		return [...starts, ...rest];
	});

	function updateContext() {
		const el = textareaEl;
		if (!el || el.selectionStart !== el.selectionEnd) {
			ctx = null;
			return;
		}
		const caret = el.selectionStart;
		const before = value.slice(0, caret);
		const at = before.lastIndexOf('@');
		const query = at === -1 ? null : before.slice(at + 1);
		if (query === null || !/^[A-Za-z0-9_.-]*$/.test(query)) {
			ctx = null;
			return;
		}
		if (ctx?.start !== at) {
			dismissedAt = null;
			selected = 0;
		} else if (ctx.query !== query) {
			selected = 0;
		}
		ctx = { start: at, query };
		dropdownPos = caretDropdownPos(el, at);
	}

	/**
	 * Measures where character `index` renders inside the textarea by mirroring
	 * its text and metrics into a hidden div, and returns coordinates (relative
	 * to the textarea) for a dropdown anchored just below that character.
	 */
	function caretDropdownPos(el: HTMLTextAreaElement, index: number): { left: number; top: number } {
		const style = getComputedStyle(el);
		const mirror = document.createElement('div');
		for (const prop of [
			'font-family',
			'font-size',
			'font-weight',
			'font-style',
			'letter-spacing',
			'line-height',
			'tab-size',
			'text-transform',
			'word-spacing',
			'padding-top',
			'padding-right',
			'padding-bottom',
			'padding-left',
			'border-top-width',
			'border-right-width',
			'border-bottom-width',
			'border-left-width'
		]) {
			mirror.style.setProperty(prop, style.getPropertyValue(prop));
		}
		mirror.style.position = 'absolute';
		mirror.style.top = '0';
		mirror.style.left = '-9999px';
		mirror.style.visibility = 'hidden';
		mirror.style.whiteSpace = 'pre-wrap';
		mirror.style.overflowWrap = 'break-word';
		mirror.style.boxSizing = 'border-box';
		const borders =
			parseFloat(style.borderLeftWidth || '0') + parseFloat(style.borderRightWidth || '0');
		mirror.style.width = `${el.clientWidth + borders}px`;
		mirror.textContent = el.value.slice(0, index);
		const marker = document.createElement('span');
		marker.textContent = String.fromCharCode(0x200b); // zero-width space
		mirror.appendChild(marker);
		document.body.appendChild(mirror);
		const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
		const pos = {
			left: Math.max(0, Math.min(marker.offsetLeft - el.scrollLeft, el.clientWidth - 264)),
			top: marker.offsetTop + lineHeight - el.scrollTop + 2
		};
		mirror.remove();
		return pos;
	}

	async function insertMention(handle: string) {
		const el = textareaEl;
		if (!el || !ctx) return;
		const caret = el.selectionStart;
		const start = ctx.start;
		value = `${value.slice(0, start)}@${handle} ${value.slice(caret)}`;
		ctx = null;
		oninput?.();
		await tick();
		const pos = start + handle.length + 2;
		el.setSelectionRange(pos, pos);
		el.focus();
	}

	/** Space/enter finished typing a mention by hand — this is the only place a new person is born. */
	function commitTyped() {
		if (!ctx) return;
		const handle = ctx.query.toLowerCase().replace(/[.-]+$/, '');
		if (!handle || !isValidHandle(handle)) return;
		if (!people.some((p) => p.handle === handle)) onnewperson?.(handle);
	}

	/** Ctrl/Cmd+Enter wraps the caret's line in `~~ ~~` (or unwraps it). */
	async function toggleCurrentLine() {
		const el = textareaEl;
		if (!el) return;
		const caret = el.selectionStart;
		const start = value.lastIndexOf('\n', caret - 1) + 1;
		const nl = value.indexOf('\n', caret);
		const end = nl === -1 ? value.length : nl;
		const line = value.slice(start, end);
		const toggled = toggleDone(line);
		if (toggled === line) return;
		value = value.slice(0, start) + toggled + value.slice(end);
		oninput?.();
		await tick();
		const pos = Math.min(
			Math.max(caret + (toggled.length - line.length) / 2, start),
			start + toggled.length
		);
		el.setSelectionRange(pos, pos);
		el.focus();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			toggleCurrentLine();
			return;
		}
		if (!active || !ctx) return;
		if (e.key === 'ArrowDown' && suggestions.length > 0) {
			e.preventDefault();
			selected = (selected + 1) % suggestions.length;
		} else if (e.key === 'ArrowUp' && suggestions.length > 0) {
			e.preventDefault();
			selected = (selected - 1 + suggestions.length) % suggestions.length;
		} else if (e.key === 'Enter') {
			if (suggestions.length > 0) {
				e.preventDefault();
				insertMention(suggestions[Math.min(selected, suggestions.length - 1)].handle);
			} else {
				commitTyped(); // newline still gets typed
			}
		} else if (e.key === ' ') {
			commitTyped(); // space still gets typed
		} else if (e.key === 'Escape') {
			e.preventDefault();
			dismissedAt = ctx.start;
		}
	}

	function syncScroll() {
		if (textareaEl && backdropEl) {
			backdropEl.scrollTop = textareaEl.scrollTop;
			backdropEl.scrollLeft = textareaEl.scrollLeft;
		}
	}

	function autofocus(node: HTMLTextAreaElement) {
		node.focus();
		node.setSelectionRange(node.value.length, node.value.length);
	}
</script>

<div class="relative">
	<!-- Highlighted mirror of the text; the transparent textarea sits exactly on top. -->
	<div
		bind:this={backdropEl}
		aria-hidden="true"
		class="editor-layer pointer-events-none absolute inset-0 overflow-hidden rounded-card border border-transparent bg-card p-3 font-mono text-sm leading-relaxed text-ink shadow-card"
	>
		{#each highlighted as line, i (i)}{#if line.done}<span class="text-faint line-through"
					>{line.segments.map((s) => s.text).join('')}</span
				>{:else}{#each line.segments as segment, j (j)}{#if segment.kind === 'time'}<span
							class="text-amber-600 dark:text-amber-400">{segment.text}</span
						>{:else if segment.kind === 'mention'}<span class="text-accent">{segment.text}</span
						>{:else}{segment.text}{/if}{/each}{/if}{line.newline}{/each}
	</div>
	<textarea
		bind:this={textareaEl}
		{@attach autofocus}
		bind:value
		{placeholder}
		rows={Math.max(10, value.split('\n').length + 2)}
		oninput={() => {
			updateContext();
			oninput?.();
		}}
		onkeydown={onKeydown}
		onkeyup={updateContext}
		onclick={updateContext}
		onblur={() => (ctx = null)}
		onscroll={syncScroll}
		spellcheck="false"
		class="editor-layer relative w-full resize-none rounded-card border-line bg-transparent p-3 font-mono text-sm leading-relaxed text-transparent caret-ink"
	></textarea>

	{#if active && ctx}
		<ul
			role="listbox"
			aria-label="People suggestions"
			class="absolute z-10 max-h-56 w-64 overflow-auto rounded-ctl border border-line bg-card py-1 shadow-lg"
			style="left: {dropdownPos.left}px; top: {dropdownPos.top}px"
		>
			{#each suggestions as person, i (person.handle)}
				<li role="presentation">
					<button
						type="button"
						role="option"
						aria-selected={i === selected}
						{@attach (node) => {
							if (i === selected) node.scrollIntoView({ block: 'nearest' });
						}}
						onmousedown={(e) => {
							e.preventDefault();
							insertMention(person.handle);
						}}
						onmousemove={() => (selected = i)}
						class="w-full px-3 py-1.5 text-left text-sm {i === selected ? 'bg-accent/10' : ''}"
					>
						<span class="font-medium text-accent">@{person.handle}</span>
						{#if person.name}<span class="ml-2 text-mute">{person.name}</span>{/if}
					</button>
				</li>
			{:else}
				<li class="px-3 py-1.5 text-xs text-faint">
					{#if ctx.query === ''}
						type a name — space or enter adds them to People
					{:else}
						space or enter adds <span class="font-mono text-accent">@{ctx.query}</span> to People
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.editor-layer {
		white-space: pre-wrap;
		overflow-wrap: break-word;
	}
</style>
