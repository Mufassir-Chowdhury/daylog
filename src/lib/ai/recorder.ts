/**
 * Recording a spoken question: the microphone with echo cancellation and
 * noise suppression, stopped on its own after a short pause once you've
 * spoken (or by a second tap), and handed over as one audio file.
 */

/** Levels (RMS, 0–1) every ~100 ms decide when you've finished. Pure, so it's testable. */
export class SilenceDetector {
	/** The quietest level at the start: the room. */
	private floor = Infinity;
	private spokeAt = -1;
	private lastLoud = -1;

	constructor(
		private opts = {
			/** Quiet this long after speaking ends it. */
			silenceMs: 1400,
			/** Nothing said this long: give up. */
			noSpeechMs: 8000,
			/** Never longer than this. */
			maxMs: 60_000,
			/** The first this-long sets the room's noise floor. */
			calibrateMs: 300
		}
	) {}

	/** One level at `ms` since the start: keep going, it's done, or nothing was said. */
	push(level: number, ms: number): 'continue' | 'done' | 'silent' {
		if (ms < this.opts.calibrateMs) {
			this.floor = Math.min(this.floor, level);
			return 'continue';
		}
		// Loud = clearly above the room, and above a minimum so a silent room isn't "speech".
		// The floor is capped, so talking from the first moment still counts as speech.
		const loud = level > Math.max(Math.min(this.floor, 0.02) * 3, 0.02);
		if (loud) {
			if (this.spokeAt < 0) this.spokeAt = ms;
			this.lastLoud = ms;
		}
		if (ms >= this.opts.maxMs) return this.spokeAt < 0 ? 'silent' : 'done';
		if (this.spokeAt < 0) return ms >= this.opts.noSpeechMs ? 'silent' : 'continue';
		return ms - this.lastLoud >= this.opts.silenceMs ? 'done' : 'continue';
	}
}

export interface Recording {
	/** Finish now and keep what was said. */
	stop(): void;
	/** Throw it away. */
	cancel(): void;
	/** The audio, or null when cancelled or nothing was said. */
	done: Promise<Blob | null>;
}

const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

export function canRecord(): boolean {
	return (
		typeof navigator !== 'undefined' &&
		!!navigator.mediaDevices?.getUserMedia &&
		typeof MediaRecorder !== 'undefined'
	);
}

/** Starts listening. Rejects when the microphone is refused or missing. `onLevel` gets 0–1. */
export async function record(onLevel?: (level: number) => void): Promise<Recording> {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
	});
	const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
	const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
	const chunks: Blob[] = [];
	recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

	const context = new AudioContext();
	const analyser = context.createAnalyser();
	analyser.fftSize = 1024;
	context.createMediaStreamSource(stream).connect(analyser);
	const samples = new Float32Array(analyser.fftSize);
	const detector = new SilenceDetector();
	const started = performance.now();

	let keep = true;
	let heard = false;
	let resolve: (blob: Blob | null) => void = () => {};
	const done = new Promise<Blob | null>((r) => (resolve = r));

	const finish = (save: boolean) => {
		if (recorder.state === 'inactive') return;
		keep = save;
		clearInterval(timer);
		recorder.stop();
	};
	recorder.onstop = () => {
		stream.getTracks().forEach((t) => t.stop());
		context.close().catch(() => {});
		resolve(keep && heard && chunks.length ? new Blob(chunks, { type: recorder.mimeType }) : null);
	};

	const timer = setInterval(() => {
		analyser.getFloatTimeDomainData(samples);
		let sum = 0;
		for (const s of samples) sum += s * s;
		const level = Math.sqrt(sum / samples.length);
		onLevel?.(Math.min(1, level * 8));
		const state = detector.push(level, performance.now() - started);
		if (state === 'continue') return;
		heard = state === 'done';
		finish(heard);
	}, 100);

	recorder.start(250);
	return {
		stop: () => {
			// A tap means "I'm done": keep it even if the level never looked like speech.
			heard = true;
			finish(true);
		},
		cancel: () => finish(false),
		done
	};
}
