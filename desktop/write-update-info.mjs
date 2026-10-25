/**
 * Writes an update manifest for an installer, in the latest.yml format
 * electron-builder writes and the Tauri app's updater (src-tauri/src/updater.rs)
 * reads: version, file name, size and base64 sha512.
 *
 *   node desktop/write-update-info.mjs <installer> <version> <manifest.yml>
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [installer, version, manifest] = process.argv.slice(2);
if (!installer || !version || !manifest) {
	console.error('usage: node desktop/write-update-info.mjs <installer> <version> <manifest.yml>');
	process.exit(1);
}

const data = readFileSync(installer);
const sha512 = createHash('sha512').update(data).digest('base64');
const name = path.basename(installer);
writeFileSync(
	manifest,
	[
		`version: ${version}`,
		'files:',
		`  - url: ${name}`,
		`    sha512: ${sha512}`,
		`    size: ${data.length}`,
		`path: ${name}`,
		`sha512: ${sha512}`,
		`releaseDate: '${new Date().toISOString()}'`,
		''
	].join('\n')
);
console.log(`${manifest}: ${name} ${version}, ${data.length} bytes`);
