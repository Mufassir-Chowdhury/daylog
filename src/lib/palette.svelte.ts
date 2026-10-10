/** Open/closed state of the in-app command palette (Ctrl+K), rendered by the root layout. */
export const palette = $state({ open: false, query: '' });

export function openPalette(query = ''): void {
	palette.query = query;
	palette.open = true;
}

export function closePalette(): void {
	palette.open = false;
}
