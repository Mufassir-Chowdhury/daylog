/**
 * Tiny fuzzy matcher for the command palette: every query character must appear
 * in order. Matches at word starts and runs of consecutive characters score
 * higher, and shorter targets win ties, so "fin" ranks "Finance" above
 * "Daily routine info".
 */
export function fuzzyScore(query: string, target: string): number | null {
	const q = query.toLowerCase().replace(/\s+/g, '');
	if (!q) return 0;
	const t = target.toLowerCase();
	let score = 0;
	let ti = 0;
	let run = 0;
	for (const ch of q) {
		const found = t.indexOf(ch, ti);
		if (found === -1) return null;
		const wordStart = found === 0 || /[\s\-_/@.(]/.test(t[found - 1]);
		run = found === ti ? run + 1 : 0;
		score += 1 + (wordStart ? 6 : 0) + run * 3 - Math.min(found - ti, 6) * 0.5;
		ti = found + 1;
	}
	if (t.startsWith(q)) score += 12;
	return score - t.length * 0.05;
}
