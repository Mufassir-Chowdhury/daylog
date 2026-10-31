import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE } from './device';
import { saveKey } from './transport';
import {
	pickAssistantVoice,
	speechText,
	STT_MODELS,
	transcribe,
	voiceError,
	type VoiceInfo
} from './voice';

describe('speechText', () => {
	it('reads lists as sentences and drops what sounds wrong aloud', () => {
		expect(
			speechText(
				'Good morning.\n- DM at 11:30 AM in 304\n- Call @rahim\n**Due:** report https://x.y'
			)
		).toBe('Good morning. DM at 11:30 AM in 304. Call rahim. Due: report.');
	});

	it('says money and ranges in words', () => {
		expect(speechText('You spent ৳1,250 on food; 9:00–10:30 is free')).toBe(
			'You spent 1,250 taka on food; 9:00 to 10:30 is free.'
		);
	});

	it('cuts long replies at a sentence and points to the screen', () => {
		const long = 'One short sentence here. '.repeat(60);
		const out = speechText(long, 100);
		expect(out.endsWith('The rest is on screen.')).toBe(true);
		expect(out.length).toBeLessThan(140);
	});
});

describe('pickAssistantVoice', () => {
	const v = (name: string, over: Partial<VoiceInfo> = {}): VoiceInfo => ({
		id: name.toLowerCase(),
		name,
		description: '',
		accent: '',
		gender: '',
		previewUrl: '',
		...over
	});

	it('prefers a calm British male voice like a composed aide', () => {
		expect(
			pickAssistantVoice([
				v('Rachel', { accent: 'american', gender: 'female' }),
				v('Daniel', { accent: 'british', gender: 'male' }),
				v('George', { accent: 'british', gender: 'male', description: 'warm' })
			])?.name
		).toBe('George');
		expect(
			pickAssistantVoice([
				v('Sam', { accent: 'american', gender: 'male' }),
				v('Custom', { accent: 'british', gender: 'male', description: 'calm, deep' })
			])?.name
		).toBe('Custom');
		expect(pickAssistantVoice([])).toBeNull();
	});
});

describe('voiceError', () => {
	it('names the problem', () => {
		expect(voiceError(401).kind).toBe('auth');
		expect(voiceError(429).kind).toBe('quota');
		expect(voiceError(400, 'quota_exceeded').kind).toBe('quota');
		expect(voiceError(422).kind).toBe('other');
	});
});

describe('transcribe', () => {
	beforeEach(() => saveKey('elevenlabs', 'xi-test'));
	afterEach(() => vi.unstubAllGlobals());

	it('sends the audio with the newest model, and falls back when that model is refused', async () => {
		const models: string[] = [];
		const fetch = vi.fn(async (_url: string, init: RequestInit) => {
			const form = init.body as FormData;
			models.push(String(form.get('model_id')));
			expect(new Headers(init.headers).get('xi-api-key')).toBe('xi-test');
			return models.length === 1
				? new Response('{"detail":"unknown model"}', { status: 422 })
				: Response.json({ text: 'What is up (laughs) today?', language_code: 'en' });
		});
		vi.stubGlobal('fetch', fetch);
		const text = await transcribe(new Blob(['x'], { type: 'audio/webm' }), DEFAULT_VOICE);
		expect(models).toEqual(STT_MODELS);
		expect(text).toBe('What is up today?');
		expect(fetch.mock.calls[0][0]).toBe('https://api.elevenlabs.io/v1/speech-to-text');
	});

	it("doesn't retry a rejected key", async () => {
		const fetch = vi.fn(async () => new Response('', { status: 401 }));
		vi.stubGlobal('fetch', fetch);
		await expect(
			transcribe(new Blob(['x'], { type: 'audio/webm' }), DEFAULT_VOICE)
		).rejects.toMatchObject({ kind: 'auth' });
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});
