import { getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
	initializeFirestore,
	persistentLocalCache,
	persistentMultipleTabManager
} from 'firebase/firestore';
import { firebaseConfig } from './firebase-config';

// The whole app is client-rendered (ssr = false), so this module only runs in the browser.
export const app = getApps()[0] ?? initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Offline persistence: edits made on a train (or before the network catches up)
// are queued locally and synced across tabs and devices when back online.
export const db = initializeFirestore(app, {
	localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
