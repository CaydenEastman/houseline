# What's left to make this a real product

The app itself works. What follows is the infrastructure around it: where data lives, who the user is, and how reminders reach a phone that has the app closed. Ordered by what unlocks the most.

## 0. Do now (no new infrastructure)

- [ ] Turn on GitHub Pages (repo Settings, Pages, branch `main`, `/ (root)`).
- [ ] Install it on your own phone and use it for a week with real tasks. Write down what annoys you.
- [ ] Export a backup from the Claude-hosted copy and import it into the Pages copy (they do not share data).
- [ ] Check the install icon, notification permission, and offline start on iPhone and on Android.

## 1. Storage that survives (built, needs your Supabase project)

- [x] Backend chosen: **Supabase** (Postgres, row-level security, private photo bucket, plain REST so no build step).
- [x] Storage adapter (`src/supabase.js`) reuses the existing merge, sharding and offline code unchanged.
- [x] Photos go to a private storage bucket, not the database.
- [x] Offline edits stay on the phone and upload when the network returns (and retry on a growing delay).
- [x] Schema versioning: data from a newer app version is never overwritten; older data is migrated on read.
- [x] Supabase project `man-of-the-house` created (us-west-1), schema applied, `config.js` filled in.
- [ ] **You:** in the Supabase dashboard, Authentication, URL Configuration: set Site URL to your Pages address and add it under Redirect URLs (without this, sign-in links will not return to the app).
- [x] Conditional writes on the main document: a stale save is refused and re-merged, so no save overwrites a newer one.
- [x] Instant updates over Supabase Realtime (polling stays as a slow fallback).
- [ ] Delete a household's photos and docs when its last member is removed.

## 2. Accounts and sign-in (built; Google needs one-time setup)

- [x] Sign in with an emailed link, and sign out, in **You, Account**. Uses Supabase Auth; no passwords stored by us.
- [x] First sign-in merges what is already on the phone into the account instead of discarding it; a different account on the same phone never inherits the previous account's data.
- [ ] **You:** turn on Google sign-in (steps in `supabase/SETUP.md`). Apple sign-in needs the $99/yr developer account and is only required if you ship an iPhone store app with Google sign-in.
- [ ] Own email sender (SMTP) once more than a few people use it.
- [ ] Delete account and "download all my data" buttons (export backup already exists).

## 3. Household sharing

- [ ] Households table: one household, several members, one shared data document.
- [ ] Invite by link or email; roles (owner, member). The task "assign to" field already exists.
- [ ] Row-level security so a user can only read and write their own household.

## 4. Reminders that arrive when the app is closed

Today: one notification a day, only when the app is opened.

- [x] Web Push: signing keys are generated inside the database (private key never leaves it); Settings, Reminders subscribes the phone and saves it (`src/push.js`, table `push_subscriptions`).
- [x] Hourly pg_cron job calls the `send-reminders` Edge Function, which sends one push per phone at its chosen local hour (time zone stored per phone). Its due-date code is a copy in `supabase/functions/send-reminders/due.js`; update it if due-date rules in `src/logic.js` change.
- [ ] **You:** on your phone, open the installed app, Settings, Reminders, pick a time and turn them on. Use the test steps in `supabase/SETUP.md`.
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
