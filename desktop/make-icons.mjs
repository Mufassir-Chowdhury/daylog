/**
 * Renders the desktop app icons (a glowing ring on a deep-blue tile) straight to
 * PNG — no image tooling needed. Run with `node desktop/make-icons.mjs`; the
 * output is committed, so this only needs re-running when the design changes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'icons');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(buf) {
	let c = 0xffffffff;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0);
	header.writeUInt32BE(size, 4);
	header[8] = 8; // bit depth
	header[9] = 6; // RGBA
	const raw = Buffer.alloc((size * 4 + 1) * size);
	for (let y = 0; y < size; y++) {
		raw[y * (size * 4 + 1)] = 0; // filter: none
		rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v) => Math.max(0, Math.min(1, v));

/** Signed distance to a rounded square centred at 0 with half-size h and radius r. */
function roundedBox(x, y, h, r) {
	const qx = Math.abs(x) - h + r;
	const qy = Math.abs(y) - h + r;
	return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * One sample in [-1, 1] space → premultiplied-free [r, g, b, a] in 0..1.
 * `tile` false draws just the ring (tray icon, which sits on the taskbar).
 */
function shade(x, y, tile) {
	const d = Math.hypot(x, y);
	const ring = Math.abs(d - 0.5) - (tile ? 0.075 : 0.13);
	const glow = Math.exp(-Math.max(0, Math.abs(d - 0.5)) * 9) * 0.55;
	const core = d - (tile ? 0.12 : 0.2);
	// Ring colour fades cyan (top) → blue (bottom) for a little life.
	const t = clamp((y / (d || 1) + 1) / 2);
	const ringRGB = [mix(0.45, 0.25, t), mix(0.85, 0.55, t), 1];

	if (!tile) {
		const a = Math.max(clamp(0.5 - ring * 40), clamp(0.5 - core * 40));
		return [...ringRGB, a];
	}

	const box = roundedBox(x, y, 0.92, 0.36);
	if (box > 0.02) return [0, 0, 0, 0];
	const boxA = clamp(0.5 - box * 60);
	// Tile: deep navy with a soft blue bloom from the top-left.
	const bloom = clamp(1 - Math.hypot(x + 0.5, y + 0.6) / 1.6);
	let rgb = [mix(0.02, 0.1, bloom), mix(0.05, 0.22, bloom), mix(0.12, 0.48, bloom)];
	rgb = rgb.map((c, i) => c + glow * [0.2, 0.45, 1][i] * 0.5);
	const ringA = clamp(0.5 - ring * 60);
	rgb = rgb.map((c, i) => mix(c, ringRGB[i], ringA));
	const coreA = clamp(0.5 - core * 60);
	rgb = rgb.map((c, i) => mix(c, [0.85, 0.95, 1][i], coreA));
	return [...rgb.map(clamp), boxA];
}

function render(size, tile) {
	const buf = Buffer.alloc(size * size * 4);
	const SS = 4;
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			let r = 0,
				g = 0,
				b = 0,
				a = 0;
			for (let sy = 0; sy < SS; sy++) {
				for (let sx = 0; sx < SS; sx++) {
					const x = ((px + (sx + 0.5) / SS) / size) * 2 - 1;
					const y = ((py + (sy + 0.5) / SS) / size) * 2 - 1;
					const [sr, sg, sb, sa] = shade(x, y, tile);
					r += sr * sa;
					g += sg * sa;
					b += sb * sa;
					a += sa;
				}
			}
			const i = (py * size + px) * 4;
			buf[i] = a ? Math.round((r / a) * 255) : 0;
			buf[i + 1] = a ? Math.round((g / a) * 255) : 0;
			buf[i + 2] = a ? Math.round((b / a) * 255) : 0;
			buf[i + 3] = Math.round((a / (SS * SS)) * 255);
		}
	}
	return png(size, buf);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'icon.png'), render(512, true));
writeFileSync(join(OUT, 'tray.png'), render(16, false));
writeFileSync(join(OUT, 'tray@2x.png'), render(32, false));
writeFileSync(join(OUT, 'favicon-64.png'), render(64, true));
console.log(`icons written to ${OUT}`);
