/**
 * Replaces the built installer with its signed copy and updates latest.yml to
 * match: signing changes the file, and electron-updater rejects an installer
 * whose sha512 or size differs from what latest.yml promised.
 *
 *   node desktop/refresh-update-info.mjs <signed installer> <dist dir>
 */
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [signed, dist] = process.argv.slice(2);
if (!signed || !dist) {
	console.error('usage: node desktop/refresh-update-info.mjs <signed installer> <dist dir>');
	process.exit(1);
}

const installer = path.join(dist, path.basename(signed));
const manifest = path.join(dist, 'latest.yml');

const before = readFileSync(installer);
const after = readFileSync(signed);
const sha512 = (buf) => createHash('sha512').update(buf).digest('base64');
const [oldHash, newHash] = [sha512(before), sha512(after)];

let yml = readFileSync(manifest, 'utf8');
if (!yml.includes(oldHash)) {
	console.error(`${manifest} doesn't describe ${installer} — was it rebuilt after signing?`);
	process.exit(1);
}
yml = yml
	.replaceAll(`sha512: ${oldHash}`, `sha512: ${newHash}`)
	.replaceAll(`size: ${before.length}`, `size: ${after.length}`);

copyFileSync(signed, installer);
writeFileSync(manifest, yml);
console.log(`${path.basename(installer)}: ${statSync(installer).size} bytes, sha512 ${newHash}`);
