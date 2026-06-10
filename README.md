# HDGEcalls

The HDGElabs Android app that auto-ships your phone's native call recordings to a private Supabase backend. Sideload-only (Android only — iOS forbids third-party CallLog/recording access). Companion to **HDGEbot** (chatbot) — both products live under the HDGElabs brand.

The app does **not** record calls. Third-party call recording is restricted in India and several other jurisdictions. Instead it harvests recordings made by the phone's native dialer:

- **Auto-sync** when your phone uses a non-Google dialer with native call recording on.
- **Manual share** for Google Dialer: open the recording → Share → **HDGEcalls**.

## Stack

- Expo SDK 54 (React Native 0.81, new architecture) + Expo Router + Expo Dev Client.
- Supabase Postgres + Storage + Auth.
- NativeWind v4 + shadcn-style component library in `src/components/ui/`.
- Local Whisper transcription (`tools/local-transcriber/`) running on the user's Mac.

## One-time Supabase setup

1. Create a Supabase project at https://supabase.com.
2. Run the migrations in order via the SQL editor:
   - `supabase/migrations/0001_init.sql` — core schema, RLS, `call-recordings` bucket.
   - `supabase/migrations/0002_wipe_recordings.sql` — only if you want to reset test data.
   - `supabase/migrations/0003_profile_and_limits.sql` — profile fields, plan + monthly limits, `profile_usage` view.
3. Authentication → Providers → Email → uncheck **Confirm email** (otherwise sign-up blocks on a confirmation link).
4. Project Settings → API. Put the URL and **anon** key in `.env`:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
   ```

## Install and build

```bash
npm install
npx expo prebuild --platform android --clean   # required after package-id rebrand
npx expo run:android --device                  # debug build with Dev Client
```

The Expo managed workflow will not work — `READ_CALL_LOG`, audio share-intent receiver, and background foreground services need the prebuilt native project. Always run `prebuild` after editing `app.json`.

For sideload distribution: `npx eas build --profile preview --platform android`.

## On-device setup (first run)

1. Install the APK on your Android phone.
2. Launch HDGEcalls — the first-run tour walks you through what the app does and which permissions it needs.
3. Sign up with email + password.
4. Open **Settings → Permissions → Request permissions**. Grant: Call log, Storage / Audio, Contacts, Notifications.
5. In phone Settings → Apps → **HDGEcalls** → Battery → **Unrestricted**. Required for background sync to survive Doze.
6. Make sure your dialer has native call recording enabled. Skip this if you use Google Dialer — see below.

### Google Dialer path

Google's policy blocks third-party apps from auto-reading its recordings. After a call:
1. Phone → Recents → tap the call → tap the recording → **Share**.
2. Choose **HDGEcalls** from the share sheet. The app uploads and pairs it to the matching call-log entry automatically.

## How sync works

- A background task (default every 15 min) reads new CallLog entries since the last cursor, scans the OEM recording folders for files newer than the cursor, pairs each recording to a call by filename digits or closest timestamp, and uploads to Supabase Storage at:
  ```
  {user_id}/by-number/{phone}/{YYYY-MM-DD}/{HHMMSS}_{callId8}.{ext}
  ```
- Only entries with a paired recording become `calls` rows — missed/un-recorded calls are dropped silently.
- The `profile_usage` view exposes current-month counters. The app soft-caps uploads at `monthly_recording_limit` and fires a one-time notification when the cap is hit.

## Plans and limits

Plan + monthly limits live on `profiles` and are written **only** by the HDGElabs website (separate `hdgebot` repo, service-role key). The app reads them and:

- Shows current usage in **Settings → Plan & usage**.
- Skips uploads once the monthly cap is reached.
- Deep-links to `https://hdgelabs.com/calls/billing` for upgrades.

The RLS policy on `profiles` blocks the client from writing `plan` / `monthly_recording_limit` / `monthly_token_limit`.

## Transcription

Local whisper.cpp on the user's Mac:

```bash
brew install whisper-cpp ffmpeg
mkdir -p tools/local-transcriber/models
curl -L -o tools/local-transcriber/models/ggml-small.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
cd tools/local-transcriber
npm install
cp .env.example .env   # fill in SUPABASE_SERVICE_ROLE_KEY
npm start              # long-running poll loop
```

See [`tools/local-transcriber/README.md`](tools/local-transcriber/README.md) for tuning and the security note.

## Repo layout

```
app/                       Expo Router screens (onboarding, auth, tabs, account, company, plan, call detail)
assets/                    Brand assets (icon, splash, logo)
src/components/ui/         shadcn-style component library
src/data/                  Supabase data helpers (profile, usage)
src/sync/                  CallLog reader, folder scan, pairing, uploader, background worker
src/shareIntent/           Google Dialer share-intent handler
src/theme/                 Light/dark/system theme provider
supabase/migrations/       SQL schema + RLS + buckets
```

## Branding

- Product: **HDGEcalls** · Company: **HDGElabs** · Sibling: HDGEbot (chatbot).
- Brand colour: lime `#C8E841` (use `bg-brand` / `text-brand-foreground` in NativeWind).
- Icon, splash, and adaptive-icon assets live in `assets/`.

## Out of scope (handled on the website)

- Billing checkout, plan upgrades, customer dashboard, CRM features. Those live in the sibling `hdgebot/` repo.
