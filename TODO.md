# What's left to make this a real product

The app itself works. What follows is the infrastructure around it: where data lives, who the user is, and how reminders reach a phone that has the app closed. Ordered by what unlocks the most.

## 0. Do now (no new infrastructure)

- [ ] Turn on GitHub Pages (repo Settings, Pages, branch `main`, `/ (root)`).
- [ ] Install it on your own phone and use it for a week with real tasks. Write down what annoys you.
- [ ] Export a backup from the Claude-hosted copy and import it into the Pages copy (they do not share data).
- [ ] Check the install icon, notification permission, and offline start on iPhone and on Android.

## 1. Storage that survives (a backend database)

Today: browser local storage (Pages) or Claude's storage (artifact). Local storage is lost if the user clears the browser or changes phones.

- [ ] Pick a backend. Easiest fits: **Supabase** (Postgres + auth + row-level security, free tier) or **Firebase** (Firestore + auth). Both give a database and sign-in in one product.
- [ ] Data model: one row per user holding the app state JSON (it is already one versioned object, `version: 2`), or normalized tables later. Start with the single JSON document per household.
- [ ] Write a new storage adapter next to `src/sync.js` that matches the same `createStore` interface (`load`, `save`, `flush`, `subscribe`, photos). The existing 3-way `mergeStates` already handles two devices editing at once, so reuse it.
- [ ] Photos: move to object storage (Supabase Storage or Firebase Storage); keep only the photo ids in state.
- [ ] Offline writes: keep local copy, queue saves, merge on reconnect (the merge code is already written).
- [ ] Add schema versioning and a migration step for when the state format changes.

## 2. Accounts and sign-in

- [ ] Sign in with **Google** (and **Apple**, which Apple requires if you ever offer any social login in an iOS store app). Email magic link as the third option.
- [ ] Use the backend's built-in auth (Supabase Auth or Firebase Auth) rather than writing your own. Do not store passwords.
- [ ] Google: create an OAuth client in Google Cloud Console, add your hosted domain to the allowed origins.
- [ ] Apple: needs an Apple Developer account ($99/yr), a Services ID, and a key.
- [ ] First sign-in migrates any local data up to the account ("Keep what's on this phone?").
- [ ] Sign-out, delete account, and "download all my data" (the export already exists).

## 3. Household sharing

- [ ] Households table: one household, several members, one shared data document.
- [ ] Invite by link or email; roles (owner, member). The task "assign to" field already exists.
- [ ] Row-level security so a user can only read and write their own household.

## 4. Reminders that arrive when the app is closed

Today: one notification a day, only when the app is opened.

- [ ] Web Push: generate VAPID keys; on "Turn on reminders" subscribe the phone and send the subscription to the backend.
- [ ] A scheduled job (Supabase cron or Cloudflare Worker cron) that runs each morning, finds each household's due and overdue tasks, and sends a push. Store the user's time zone and preferred hour.
- [ ] iPhone only delivers web push to apps added to the Home Screen (iOS 16.4+). Keep the install tip visible.
- [ ] Optional email digest (Resend or Postmark) for people who do not install, and as a fallback.
- [ ] Optional SMS later (Twilio); costs money per message.
- [ ] Notification settings: pick the hour, quiet days, what counts as "due soon".

## 5. A running server (only if needed)

You may not need your own server. Managed backend + a cron function covers everything above.

- [ ] Decide: **serverless** (Supabase Edge Functions or Cloudflare Workers, cheapest, nothing to maintain) vs a small server (Node on Fly.io, Render, or Railway).
- [ ] Needed for: sending push and email, secrets (VAPID private key, email API key), and any future paid features.
- [ ] Keep the client static on GitHub Pages or move it to Cloudflare Pages / Netlify for a custom domain and headers.
- [ ] Buy a domain; set up HTTPS (automatic on those hosts).

## 6. Real app stores (optional)

- [ ] Wrap the same code with **Capacitor** for an iOS and Android app. Gives reliable native push and an App Store / Play Store listing.
- [ ] Apple Developer $99/yr; Google Play $25 once. Prepare screenshots, privacy policy, and support URL.
- [ ] Apple review is stricter: a plain website wrapper can be rejected, so add something native (push, haptics, widgets).

## 7. Money and legal (if you sell it)

- [ ] Decide the model: free, one-time price, or subscription. Stripe for web; store billing for store apps.
- [ ] Privacy policy and terms (you will store home details, vehicle info, and photos).
- [ ] Do not collect anything sensitive you do not need. Never store payment cards yourself.
- [ ] Backups of the database and a plan for account deletion requests.

## 8. Quality and polish

- [ ] Test on a range of real phones (small Android, large iPhone, tablet).
- [ ] Error reporting (Sentry free tier) so you hear about crashes.
- [ ] Simple analytics, privacy-friendly (Plausible or none).
- [ ] CI: run `npm test` on every push (GitHub Actions).
- [ ] Home-screen widget / "today" shortcut for fast access (needs the store-app route).
- [ ] Spanish translation (you are fluent), since the task text is all in one place.

## Suggested order

1. Items 0 (this week).
2. Supabase: auth with Google + one JSON document per user (items 1 and 2, basic). Solves lost data and gives two-phone sync back.
3. Web Push with a daily cron (item 4). This is the "it actually reminds me" moment.
4. Household sharing (item 3).
5. Store apps and billing only if you want to distribute it widely.
