/**
 * Voice mode through ElevenLabs: your speech becomes text for the normal
 * assistant loop (so tools, memory and approvals work the same), and its
 * replies are read aloud in a calm, warm voice. Only on while an ElevenLabs
 * key is saved on this device (Settings → Assistant → Voice).
 *
 * Web: straight from the page with the key from this browser's storage.
 * Desktop: through the Rust shell, which adds the key from the OS keychain
 * (src-tauri/src/voice.rs). Either way audio goes to ElevenLabs and nowhere else.
 */
import { desktop } from '../desktop';
import type { TtsModel, VoicePrefs } from './device';
import { providerFetch, webVoiceKey } from './transport';

export const ELEVEN = 'https://api.elevenlabs.io/v1';

export const TTS_MODELS: { id: TtsModel; label: string }[] = [
	{ id: 'eleven_flash_v2_5', label: 'Fast — replies start sooner' },
	{ id: 'eleven_multilingual_v2', label: 'Richer — a little slower' }
];

/** Speech-to-text models, newest first; an older one is tried if a newer one is refused. */
export const STT_MODELS = ['scribe_v2', 'scribe_v1'];

/**
 * How the voice is delivered: steady but not flat, close to the chosen voice,
 * a touch of warmth, unhurried. JARVIS is composed — no drama.
 */
export const VOICE_SETTINGS = {
	stability: 0.55,
	similarity_boost: 0.75,
	style: 0.2,
	use_speaker_boost: true,
	speed: 1
};

const OUTPUT_FORMAT = 'mp3_44100_128';

export type VoiceErrorKind = 'no_key' | 'auth' | 'quota' | 'network' | 'mic' | 'other';

export class VoiceError extends Error {
	constructor(
		public kind: VoiceErrorKind,
		message: string
	) {
		super(message);
	}
}

/** A failed ElevenLabs answer in plain words. */
export function voiceError(status: number, detail = ''): VoiceError {
	if (status === 401 || status === 403)
		return new VoiceError(
			'auth',
			'ElevenLabs rejected the key — check it in Settings → Assistant → Voice.'
		);
	if (status === 402 || status === 429 || /quota|credits/i.test(detail))
		return new VoiceError(
			'quota',
			'ElevenLabs is out of credit or rate-limited — try again later.'
		);
	return new VoiceError('other', `ElevenLabs couldn't do that (${status}).`);
}

/** `HTTP 401: …` from the desktop shell → its status. */
const desktopStatus = (e: unknown) => Number(/HTTP (\d{3})/.exec(String(e))?.[1] ?? 0);

function rethrow(e: unknown): never {
	if (e instanceof VoiceError) throw e;
	const message = String(e instanceof Error ? e.message : e);
	if (/No API key/i.test(message) || (e as { kind?: string })?.kind === 'no_key')
		throw new VoiceError('no_key', 'Add an ElevenLabs key in Settings → Assistant → Voice.');
	const status = desktopStatus(message);
	if (status) throw voiceError(status, message);
	throw new VoiceError('network', "Couldn't reach ElevenLabs — check your connection.");
}

// ——— Voices.

export interface VoiceInfo {
	id: string;
	name: string;
	description: string;
	accent: string;
	gender: string;
	previewUrl: string;
}

/** The voices on your ElevenLabs account (premade ones included). Also proves the key works. */
export async function listVoices(): Promise<VoiceInfo[]> {
	let res: Response;
	try {
		res = await providerFetch('elevenlabs')(`${ELEVEN}/voices`);
	} catch (e) {
		rethrow(e);
	}
	if (!res.ok) throw voiceError(res.status, await res.text().catch(() => ''));
	const data = (await res.json()) as { voices?: Record<string, unknown>[] };
	return (data.voices ?? []).map((v) => {
		const labels = (v.labels ?? {}) as Record<string, string>;
		return {
			id: String(v.voice_id ?? ''),
			name: String(v.name ?? ''),
			description: String(labels.description ?? v.description ?? ''),
			accent: String(labels.accent ?? ''),
			gender: String(labels.gender ?? ''),
			previewUrl: String(v.preview_url ?? '')
		};
	});
}

/** Names of ElevenLabs' stock voices that suit a composed British aide, best first. */
const PREFERRED = ['george', 'daniel', 'brian', 'charlie'];

/** The voice that sounds most like a calm, friendly JARVIS: British, male, warm or calm. */
export function pickAssistantVoice(voices: VoiceInfo[]): VoiceInfo | null {
	const score = (v: VoiceInfo) => {
		const name = v.name.toLowerCase();
		const about = `${v.description} ${v.accent}`.toLowerCase();
		const preferred = PREFERRED.findIndex((p) => name.startsWith(p));
		return (
			(preferred === -1 ? 0 : 10 - preferred) +
			(/british|english/.test(about) ? 4 : 0) +
			(/^male/.test(v.gender.toLowerCase()) ? 2 : 0) +
			(/(calm|warm|deep|confident|smooth|narrat|mature|composed)/.test(about) ? 1 : 0)
		);
	};
	return voices.slice().sort((a, b) => score(b) - score(a))[0] ?? null;
}

// ——— Speaking.

const SYMBOLS: [RegExp, string][] = [
	[/৳\s?(\d[\d,.]*)/g, '$1 taka'],
	[/(\d)\s?[–—-]\s?(\d)/g, '$1 to $2'],
	[/\s?→\s?/g, ' to '],
	[/&/g, ' and ']
];

/**
 * A reply as it should be heard: no list markers, links or markdown, @handles
 * as names, money and ranges in words, and cut at a sentence once it runs long
 * (the rest stays on screen).
 */
export function speechText(text: string, max = 900): string {
	let out = text
		.replace(/https?:\/\/\S+/g, '')
		.replace(/[*_`#>]+/g, '')
		.replace(/@([a-z0-9_.-]+)/gi, '$1')
		.split('\n')
		.map((l) => l.replace(/^\s*(?:[-•]|\d+[.)])\s+/, '').trim())
		.filter(Boolean)
		// A line without its own ending reads as its own sentence.
		.map((l) => (/[.!?:;,]$/.test(l) ? l : `${l}.`))
		.join(' ');
	for (const [re, to] of SYMBOLS) out = out.replace(re, to);
	out = out.replace(/\s+/g, ' ').trim();
	if (out.length <= max) return out;
	const cut = out.slice(0, max);
	const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
	return `${end > 0 ? cut.slice(0, end + 1) : cut} The rest is on screen.`;
}

function speakBody(text: string, prefs: VoicePrefs) {
	return JSON.stringify({
		text,
		model_id: prefs.model,
		voice_settings: VOICE_SETTINGS,
		...(prefs.language ? { language_code: prefs.language } : {})
	});
}

/**
 * The reply's audio. On the web it streams: `onChunk` gets the MP3 as it
 * arrives, so playing can start before it's all there. Resolves with the
 * whole MP3 once it's done.
 */
export async function synthesize(
	text: string,
	voiceId: string,
	prefs: VoicePrefs,
	onChunk?: (chunk: Uint8Array) => void,
	signal?: AbortSignal
): Promise<Blob> {
	if (desktop) {
		try {
			const audio = await desktop.voiceSpeak({
				voice_id: voiceId,
				output_format: OUTPUT_FORMAT,
				body: speakBody(text, prefs)
			});
			onChunk?.(new Uint8Array(audio));
			return new Blob([audio], { type: 'audio/mpeg' });
		} catch (e) {
			rethrow(e);
		}
	}
	const key = webVoiceKey();
	if (!key) rethrow({ kind: 'no_key' });
	let res: Response;
	try {
		res = await fetch(
			`${ELEVEN}/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${OUTPUT_FORMAT}`,
			{
				method: 'POST',
				headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
				body: speakBody(text, prefs),
				signal
			}
		);
	} catch (e) {
		if ((e as Error)?.name === 'AbortError') throw e;
		rethrow(e);
	}
	if (!res.ok || !res.body) throw voiceError(res.status, await res.text().catch(() => ''));
	const chunks: Uint8Array[] = [];
	const reader = res.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		onChunk?.(value);
	}
	return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
}

// ——— Listening.

async function transcribeOnce(audio: Blob, model: string, language: string): Promise<string> {
	if (desktop) {
		try {
			const json = await desktop.voiceTranscribe(new Uint8Array(await audio.arrayBuffer()), {
				mime: audio.type || 'audio/webm',
				model,
				...(language ? { language } : {})
			});
			return String((JSON.parse(json) as { text?: string }).text ?? '');
		} catch (e) {
			rethrow(e);
		}
	}
	const form = new FormData();
	form.append('model_id', model);
	if (language) form.append('language_code', language);
	form.append('file', audio, audio.type.includes('mp4') ? 'speech.m4a' : 'speech.webm');
	let res: Response;
	try {
		res = await providerFetch('elevenlabs')(`${ELEVEN}/speech-to-text`, {
			method: 'POST',
			body: form
		});
	} catch (e) {
		rethrow(e);
	}
	if (!res.ok) throw voiceError(res.status, await res.text().catch(() => ''));
	return String(((await res.json()) as { text?: string }).text ?? '');
}

/**
 * What was said. Tries the newest speech-to-text model and falls back to the
 * one before it when ElevenLabs refuses the model (an older account or API).
 * Bracketed sound tags ("(laughs)", "[music]") are dropped.
 */
export async function transcribe(audio: Blob, prefs: VoicePrefs): Promise<string> {
	let last: unknown;
	for (const model of STT_MODELS) {
		try {
			const text = await transcribeOnce(audio, model, prefs.language);
			return text
				.replace(/[([][^)\]]{1,30}[)\]]/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
		} catch (e) {
			last = e;
			// Only a refused request is worth another model; auth, quota and network aren't.
			if (!(e instanceof VoiceError && e.kind === 'other')) break;
		}
	}
	throw last;
}
