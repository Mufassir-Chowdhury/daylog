# daylog

A todo app built on the "one text file" theory: every day is just text you append to.
No forms, no checkboxes — you type lines, and the app makes the text useful:

- **One page per day.** Jump with ← / →, the calendar picker, **Today**, or **+ Next day** —
  no more typing date headers by hand. Go back to any past day.
- **Timed tasks.** Start a line with a time (`09:00PM call mom`, `21:00 gym`) and it's
  pinned to a **Schedule** section at the top of the day, sorted by time.
- **People.** Write `@rahim` anywhere and Rahim gets a unique profile automatically.
  His profile shows every line that ever mentioned him, plus a freeform name/bio you can
  append notes to — after a while you have a detailed bio of everyone you deal with.
- **Anywhere.** Data lives in Firestore with offline persistence — log in from any device
  (works fine from a phone), edits sync when you're online.
- 🎤 Voice input — _coming soon_.

Stack: SvelteKit (Svelte 5) + Tailwind, Firebase Auth + Firestore, all client-side —
there is no app server to run or maintain.

## One-time Firebase setup

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com) (free Spark plan is enough).
2. **Authentication → Sign-in method**: enable **Google** and/or **Email/Password**.
3. **Firestore Database → Create database** (production mode).
4. **Firestore → Rules**: paste the contents of [`firestore.rules`](./firestore.rules) and publish.
5. **Project settings → Your apps → Add app → Web**: register an app, copy the
   `firebaseConfig` object into [`src/lib/firebase-config.ts`](./src/lib/firebase-config.ts).
6. When you deploy, add your domain under **Authentication → Settings → Authorized domains**
   (localhost is already authorized).

## Developing

```sh
npm install
npm run gen   # generates worker-configuration.d.ts (once, and after wrangler.jsonc changes)
npm run dev
```

## Testing

```sh
npm run test:unit   # parser + date unit tests (vitest)
npm run test:e2e    # playwright, builds and runs the real app
```

## Deploying

The project is set up for Cloudflare Workers:

```sh
npm run build
npx wrangler deploy
```

Any static host works too (the app is fully client-rendered) — swap the adapter if you prefer.
