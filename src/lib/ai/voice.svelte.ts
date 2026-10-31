/**
 * Voice mode as app state: whether it's on (an ElevenLabs key on this
 * device and a microphone), listening and transcribing, and what's being read
 * aloud. One thing at a time: starting to listen stops any speech, and a new
 * reply cuts off the last.
 */
import { desktop } from '../desktop';
import { loadDevicePrefs, saveDevicePrefs } from './device';
import { canRecord, record, type Recording } from './recorder';
import { hasVoiceKey } from './transport';
import {
	listVoices,
	pickAssistantVoice,
	speechText,
	synthesize,
	transcribe,
	VoiceError
} from './voice';

export const voice = $state({
	/** An ElevenLabs key is saved here: the mic and "read aloud" show. */
	available: false,
	phase: 'idle' as 'idle' | 'listening' | 'transcribing',
	/** Microphone level while listening, 0–1. */
	level: 0,
	speaking: false,
	/** The last problem, in plain words (cleared on the next try). */
	error: ''
});

/** Turns voice mode on or off from whether a key is saved. Call after saving or removing one. */
export async function refreshVoice(): Promise<void> {
	voice.available = canRecord() && (await hasVoiceKey().catch(() => false));
	if (!voice.available) {
		cancelListening();
		stopSpeaking();
	}
}

const message = (e: unknown) =>
	e instanceof VoiceError ? e.message : 'Something went wrong with voice — try again.';

// ——— Listening.

let recording: Recording | null = null;

/** Listens until you pause (or tap again) and returns what you said, or null. */
export async function listen(): Promise<string | null> {
	if (!voice.available || voice.phase !== 'idle') return null;
	stopSpeaking();
	voice.error = '';
	try {
		recording = await record((level) => (voice.level = level));
	} catch {
		voice.error = desktop
			? 'The microphone is off for daylog — allow it in your system settings.'
			: 'The microphone is blocked — allow it for this site in the browser.';
		return null;
	}
	voice.phase = 'listening';
	const audio = await recording.done;
	recording = null;
	voice.level = 0;
	if (!audio) {
		voice.phase = 'idle';
		return null;
	}
	voice.phase = 'transcribing';
	try {
		return (await transcribe(audio, loadDevicePrefs().voice)) || null;
	} catch (e) {
		voice.error = message(e);
		return null;
	} finally {
		voice.phase = 'idle';
	}
}

/** "I'm done": stop listening and transcribe what was said. */
export function stopListening(): void {
	recording?.stop();
}

export function cancelListening(): void {
	recording?.cancel();
}

// ——— Speaking.

let current: { abort: AbortController; audio: HTMLAudioElement | null; url: string } | null = null;

/** The chosen voice, or the most JARVIS-like one on the account (remembered for next time). */
async function voiceId(): Promise<string> {
	const prefs = loadDevicePrefs();
	if (prefs.voice.voiceId) return prefs.voice.voiceId;
	const pick = pickAssistantVoice(await listVoices());
	if (!pick) throw new VoiceError('other', 'No voices on this ElevenLabs account.');
	saveDevicePrefs({ ...prefs, voice: { ...prefs.voice, voiceId: pick.id } });
	return pick.id;
}

const streamable = () =>
	!desktop && typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg');

/** Reads `text` aloud; resolves when it has finished (or was stopped). */
export async function speak(text: string): Promise<void> {
	if (!voice.available) return;
	const spoken = speechText(text);
	if (!spoken) return;
	stopSpeaking();
	voice.error = '';
	const job = { abort: new AbortController(), audio: null as HTMLAudioElement | null, url: '' };
	current = job;
	voice.speaking = true;
	const prefs = loadDevicePrefs().voice;
	try {
		const id = await voiceId();
		if (current !== job) return;
		if (streamable()) await playStreaming(job, spoken, id, prefs);
		else {
			const blob = await synthesize(spoken, id, prefs, undefined, job.abort.signal);
			if (current !== job) return;
			job.url = URL.createObjectURL(blob);
			job.audio = new Audio(job.url);
			await playToEnd(job.audio);
		}
	} catch (e) {
		if ((e as Error)?.name !== 'AbortError' && current === job) voice.error = message(e);
	} finally {
		if (current === job) {
			voice.speaking = false;
			current = null;
		}
		if (job.url) URL.revokeObjectURL(job.url);
	}
}

/** Starts playing as soon as the first audio arrives. */
async function playStreaming(
	job: NonNullable<typeof current>,
	text: string,
	id: string,
	prefs: ReturnType<typeof loadDevicePrefs>['voice']
): Promise<void> {
	const source = new MediaSource();
	job.url = URL.createObjectURL(source);
	const audio = (job.audio = new Audio(job.url));
	await new Promise((r) => source.addEventListener('sourceopen', r, { once: true }));
	const buffer = source.addSourceBuffer('audio/mpeg');
	const queue: Uint8Array[] = [];
	let arrived = false;
	const pump = () => {
		if (buffer.updating || source.readyState !== 'open') return;
		const next = queue.shift();
		if (next) buffer.appendBuffer(next as BufferSource);
		else if (arrived) source.endOfStream();
	};
	buffer.addEventListener('updateend', pump);
	const ended = playToEnd(audio, false);
	let started = false;
	await synthesize(
		text,
		id,
		prefs,
		(chunk) => {
			queue.push(chunk);
			pump();
			if (!started) {
				started = true;
				audio.play().catch(() => {});
			}
		},
		job.abort.signal
	);
	arrived = true;
	pump();
	// Nothing came back: nothing to wait for.
	if (started) await ended;
}

function playToEnd(audio: HTMLAudioElement, start = true): Promise<void> {
	return new Promise((resolve) => {
		audio.onended = () => resolve();
		audio.onerror = () => resolve();
		audio.onpause = () => audio.ended || resolve();
		if (start) audio.play().catch(() => resolve());
	});
}

export function stopSpeaking(): void {
	const job = current;
	current = null;
	voice.speaking = false;
	if (!job) return;
	job.abort.abort();
	job.audio?.pause();
	if (job.url) URL.revokeObjectURL(job.url);
}
