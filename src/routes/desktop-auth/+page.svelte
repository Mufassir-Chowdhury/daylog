<script lang="ts">
	import { page } from '$app/state';
	import { auth } from '$lib/firebase';
	import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';

	// Opened in the user's normal browser by the desktop app (Google blocks
	// sign-in inside embedded webviews). Signs in with Google here, then hands the Google
	// tokens to the app's local server, which only accepts them with the
	// one-time `state` it issued.
	const nonce = page.url.searchParams.get('state') ?? '';
	const port = page.url.searchParams.get('port') ?? '';
	const valid = /^[0-9a-f]{48}$/.test(nonce) && /^\d{2,5}$/.test(port);

	let status: 'idle' | 'working' | 'done' | 'error' = $state('idle');
	let error = $state('');

	async function signIn() {
		status = 'working';
		error = '';
		try {
			const result = await signInWithPopup(auth, new GoogleAuthProvider());
			const credential = GoogleAuthProvider.credentialFromResult(result);
			if (!credential) throw new Error('Google did not return a credential.');
			// text/plain keeps this a "simple" request — no CORS preflight in dev.
			const response = await fetch(`http://localhost:${port}/__desktop-auth`, {
				method: 'POST',
				headers: { 'Content-Type': 'text/plain' },
				body: JSON.stringify({
					state: nonce,
					idToken: credential.idToken ?? null,
					accessToken: credential.accessToken ?? null
				})
			});
			const reply = (await response.json().catch(() => ({}))) as { error?: string };
			if (!response.ok) throw new Error(reply.error ?? 'daylog did not accept the sign-in.');
			status = 'done';
		} catch (e) {
			status = 'error';
			error =
				e instanceof TypeError
					? 'Could not reach daylog — is the desktop app still running?'
					: e instanceof Error
						? e.message.replace('Firebase: ', '')
						: 'Something went wrong';
		} finally {
			// The desktop app holds the session; don't leave one behind in this browser.
			signOut(auth).catch(() => {});
		}
	}
</script>

<svelte:head>
	<title>Sign in · daylog desktop</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
	<div class="w-full max-w-sm rounded-card border border-line bg-card p-6 text-center shadow-card">
		<span class="brand-orb mx-auto block scale-150" aria-hidden="true"></span>
		<h1 class="mt-5 font-display text-xl font-bold tracking-tight text-ink">
			Sign in to daylog desktop
		</h1>

		{#if !valid}
			<p class="mt-3 text-sm text-mute">
				This link is incomplete. Click “Continue with Google” in the daylog app to start again.
			</p>
		{:else if status === 'done'}
			<p class="mt-3 text-sm text-mute">
				You're signed in — switch back to daylog. You can close this tab.
			</p>
		{:else}
			<p class="mt-3 text-sm text-mute">
				Google only allows sign-in from a regular browser, so the app sent you here. Your account
				goes straight back to the app on this computer.
			</p>
			<button
				type="button"
				onclick={signIn}
				disabled={status === 'working'}
				class="mt-5 w-full rounded-ctl bg-accent-fill px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
			>
				{status === 'working' ? 'Signing in…' : 'Continue with Google'}
			</button>
			{#if error}
				<p class="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
			{/if}
		{/if}
	</div>
</div>
