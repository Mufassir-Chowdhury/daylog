<script lang="ts">
	import { signInWithEmail, signInWithGoogle, signUpWithEmail } from '$lib/auth.svelte';
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

	function submit(event: SubmitEvent) {
		event.preventDefault();
		run(() =>
			mode === 'signin' ? signInWithEmail(email, password) : signUpWithEmail(email, password)
		);
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4">
	<div class="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
		<h1 class="text-2xl font-bold text-gray-900">daylog</h1>
		<p class="mt-1 text-sm text-gray-500">
			One text file per day. Times float to the top, @people get profiles.
		</p>

		{#if !isConfigured}
			<div class="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
				Firebase isn't configured yet. Paste your web app config into
				<code class="font-mono text-xs">src/lib/firebase-config.ts</code> — see README.md.
			</div>
		{/if}

		<button
			type="button"
			onclick={() => run(signInWithGoogle)}
			disabled={busy}
			class="mt-5 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
		>
			Continue with Google
		</button>

		<div class="my-4 flex items-center gap-3 text-xs text-gray-400">
			<div class="h-px flex-1 bg-gray-200"></div>
			or
			<div class="h-px flex-1 bg-gray-200"></div>
		</div>

		<form onsubmit={submit} class="space-y-3">
			<input
				type="email"
				required
				placeholder="email"
				autocomplete="email"
				bind:value={email}
				class="w-full rounded-lg border-gray-300 text-sm"
			/>
			<input
				type="password"
				required
				minlength="6"
				placeholder="password"
				autocomplete={mode === 'signin' ? 'current-password' : 'new-password'}
				bind:value={password}
				class="w-full rounded-lg border-gray-300 text-sm"
			/>
			<button
				type="submit"
				disabled={busy}
				class="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
			>
				{mode === 'signin' ? 'Sign in' : 'Create account'}
			</button>
		</form>

		{#if error}
			<p class="mt-3 text-sm text-red-600">{error}</p>
		{/if}

		<button
			type="button"
			class="mt-4 text-sm text-blue-600 hover:underline"
			onclick={() => (mode = mode === 'signin' ? 'signup' : 'signin')}
		>
			{mode === 'signin' ? 'No account? Create one' : 'Have an account? Sign in'}
		</button>
	</div>
</div>
