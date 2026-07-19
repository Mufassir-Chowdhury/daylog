import {
	GoogleAuthProvider,
	createUserWithEmailAndPassword,
	onAuthStateChanged,
	signInWithEmailAndPassword,
	signInWithPopup,
	signOut,
	type User
} from 'firebase/auth';
import { invalidateAll } from '$app/navigation';
import { auth } from './firebase';

export const session = $state({
	user: null as User | null,
	/** false until Firebase has restored (or ruled out) a persisted session. */
	ready: false
});

onAuthStateChanged(auth, (user) => {
	const changed = session.ready && session.user?.uid !== user?.uid;
	session.user = user;
	session.ready = true;
	// Load functions ran against the previous auth state — re-run them.
	if (changed) invalidateAll();
});

/** Resolves with the current user once Firebase has restored the session. */
export function authReady(): Promise<User | null> {
	if (session.ready) return Promise.resolve(session.user);
	return new Promise((resolve) => {
		const unsubscribe = onAuthStateChanged(auth, (user) => {
			unsubscribe();
			resolve(user);
		});
	});
}

export function signInWithGoogle() {
	return signInWithPopup(auth, new GoogleAuthProvider());
}

export function signInWithEmail(email: string, password: string) {
	return signInWithEmailAndPassword(auth, email, password);
}

export function signUpWithEmail(email: string, password: string) {
	return createUserWithEmailAndPassword(auth, email, password);
}

export function logOut() {
	return signOut(auth);
}
