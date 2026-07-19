/**
 * Paste your Firebase web app config here (Firebase console → Project settings →
 * Your apps → Web app → SDK setup and configuration). See README.md for the full
 * setup steps. This config is public by design — security comes from Firestore rules.
 */
export const firebaseConfig = {

  apiKey: "AIzaSyAf5Yof9GDAnqTTDFQwz7TY5BHk87rWQp8",

  authDomain: "daylog-5c4da.firebaseapp.com",

  projectId: "daylog-5c4da",

  storageBucket: "daylog-5c4da.firebasestorage.app",

  messagingSenderId: "420838910898",

  appId: "1:420838910898:web:fa1b770a7d3028895d12ab",

  measurementId: "G-NPKGJBQKX0"

};


export const isConfigured = firebaseConfig.apiKey !== 'PASTE_ME';
