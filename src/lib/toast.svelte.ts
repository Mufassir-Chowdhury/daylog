/** App-wide transient messages, rendered by <Toaster /> in the root layout. */

export interface Toast {
	id: number;
	message: string;
	tone: 'info' | 'error';
	/** Shown as an "Undo" button; the toast closes once it's clicked. */
	undo?: () => void;
}

export const toasts: Toast[] = $state([]);

let nextId = 1;
/** Auto-dismiss timers by toast id — bookkeeping only, not reactive. */
const timers: Record<number, ReturnType<typeof setTimeout>> = {};

export function toast(
	message: string,
	opts: { undo?: () => void; tone?: Toast['tone']; duration?: number } = {}
): void {
	const id = nextId++;
	toasts.push({ id, message, tone: opts.tone ?? 'info', undo: opts.undo });
	// Keep the stack short — the oldest message goes first.
	if (toasts.length > 3) dismiss(toasts[0].id);
	timers[id] = setTimeout(() => dismiss(id), opts.duration ?? (opts.undo ? 6000 : 3500));
}

export function dismiss(id: number): void {
	clearTimeout(timers[id]);
	delete timers[id];
	const i = toasts.findIndex((t) => t.id === id);
	if (i !== -1) toasts.splice(i, 1);
}

/** Standard reaction to a failed background save. */
export function saveFailed(): void {
	toast('Save failed — check your connection; changes may not be stored.', { tone: 'error' });
}
