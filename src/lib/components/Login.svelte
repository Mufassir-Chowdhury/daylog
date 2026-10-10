<script lang="ts">
	import {
		signInWithEmail,
		signInWithGoogle,
		signInWithGoogleTokens,
		signUpWithEmail
	} from '$lib/auth.svelte';
	import { desktop } from '$lib/desktop';
	import { isConfigured } from '$lib/firebase-config';

	let email = $state('');
	let password = $state('');
	let mode: 'signin' | 'signup' = $state('signin');
	let error = $state('');
	let busy = $state(false);

	async function run(action: () => Promise<unknown>) {
		error = '';
		busy = true;
		try {
			await action();
		} catch (e) {
			error = e instanceof Error ? e.message.replace('Firebase: ', '') : 'Something went wrong';
		} finally {
			busy = false;
		}
	}

	// Google won't sign in inside the desktop app's embedded browser, so the
	// desktop app hands Google sign-in to the system browser and waits here.
	let waitingForBrowser = $state(false);

	$effect(() =>
		desktop?.onGoogleCredential(({ idToken, accessToken }) => {
			waitingForBrowser = false;
			run(() => signInWithGoogleTokens(idToken, accessToken));
		})
	);

	function google() {
		if (desktop) {
			error = '';
			waitingForBrowser = true;
			desktop.startGoogleSignIn();
		} else {
			run(signInWithGoogle);
		}
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		run(() =>
			mode === 'signin' ? signInWithEmail(email, password) : signUpWithEmail(email, password)
		);
	}
</script>

<div class="flex min-h-screen items-center justify-center px-4">
	<div class="w-full max-w-sm rounded-card border border-line bg-card p-6 shadow-card">
		<div class="flex items-center gap-3">
			{#if desktop}
				<span class="brand-orb scale-125" aria-hidden="true"></span>
			{:else}
				<span
					class="grid h-10 w-10 place-items-center rounded-ctl bg-accent-fill font-display text-lg font-black text-on-accent"
				>
					d
				</span>
			{/if}
			<h1 class="font-display text-2xl font-bold tracking-tight text-ink">daylog</h1>
		</div>
		<p class="mt-3 text-sm text-mute">
			One text file per day. Times float to the top, @people get profiles.
		</p>

		{#if !isConfigured}
			<div
				class="mt-4 rounded-ctl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"
			>
				Firebase isn't configured yet. Paste your web app config into
				<code class="font-mono text-xs">src/lib/firebase-config.ts</code> — see README.md.
			</div>
		{/if}

		<button
			type="button"
			onclick={google}
			disabled={busy}
			class="mt-5 w-full rounded-ctl border border-line px-4 py-2 text-sm font-medium text-mute hover:bg-tint hover:text-ink disabled:opacity-50"
		>
			Continue with Google
		</button>
		{#if waitingForBrowser}
			<p class="mt-2 flex items-center gap-2 text-sm text-mute" role="status">
				<span class="palette-orb palette-orb-busy" aria-hidden="true"></span>
				Finish signing in in your browser — daylog will pick it up.
				<button
					type="button"
					onclick={() => (waitingForBrowser = false)}
					class="ml-auto text-xs text-faint hover:text-ink">Cancel</button
				>
			</p>
		{/if}

		<div class="my-4 flex items-center gap-3 text-xs text-faint">
			<div class="h-px flex-1 bg-line"></div>
			or
			<div class="h-px flex-1 bg-line"></div>
		</div>

		<form onsubmit={submit} class="space-y-3">
			<input
				type="email"
				required
				placeholder="email"
				autocomplete="email"
				bind:value={email}
				class="w-full rounded-ctl border-line bg-card text-sm text-ink"
			/>
			<input
				type="password"
				required
				minlength="6"
				placeholder="password"
				autocomplete={mode === 'signin' ? 'current-password' : 'new-password'}
				bind:value={password}
				class="w-full rounded-ctl border-line bg-card text-sm text-ink"
			/>
			<button
				type="submit"
				disabled={busy}
				class="w-full rounded-ctl bg-accent-fill px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
			>
				{mode === 'signin' ? 'Sign in' : 'Create account'}
			</button>
		</form>

		{#if error}
			<p class="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
		{/if}

		<button
			type="button"
			class="mt-4 text-sm text-accent hover:underline"
			onclick={() => (mode = mode === 'signin' ? 'signup' : 'signin')}
		>
			{mode === 'signin' ? 'No account? Create one' : 'Have an account? Sign in'}
		</button>
	</div>
</div>
