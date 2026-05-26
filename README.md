# Calling

Auto-sync of native Android call recordings + call history into Supabase, with pluggable transcription. Sideload-only Android app (no Play Store, Android-only — iOS forbids third-party CallLog/recording access).

Modeled on Callyzer Biz: the app does **not** record calls (third-party call recording is restricted in India and several other jurisdictions). Instead it harvests recordings made by the phone's native dialer:

- **Auto-sync** when your phone uses a non-Google dialer with native call recording on.
- **Manual share** for Google Dialer: open the recording → Share → Calling app.

## Stack

- Expo (React Native) + Expo Router + Expo Dev Client (managed workflow can't access CallLog / Storage / share intents — Dev Client gives us the needed native modules).
- Supabase Postgres + Storage + Auth + Edge Functions.
- Transcription provider is pluggable: Deepgram, OpenAI Whisper, AssemblyAI, or stub.

## One-time Supabase setup

1. Create a Supabase project at https://supabase.com.
2. Run the migration:
   - **Easy path:** open the SQL editor in Supabase Studio and paste the contents of `supabase/migrations/0001_init.sql`.
   - **CLI path:** `supabase link --project-ref <ref>` then `supabase db push`.
3. Confirm the `call-recordings` bucket exists under Storage (the migration creates it). It must remain **private**.
4. Get the project URL and **anon** key from Project Settings → API. Put them in `.env`:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
   ```
5. Set up transcription. Two paths:
   - **Local Whisper on your Mac (chosen for this project)** — see [`tools/local-transcriber/`](tools/local-transcriber/README.md). Runs whisper.cpp with the small GGML model on Apple Silicon; no Edge Function deploy needed.
   - **Cloud Edge Function (alternative)** — `supabase functions deploy transcribe-call --no-verify-jwt`, then `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... TRANSCRIPTION_PROVIDER=deepgram|openai|assemblyai ...`. Add a Storage webhook (Supabase Studio → Database → Webhooks → `storage.objects` INSERT → `https://<ref>.functions.supabase.co/transcribe-call`). Pick **one** path, not both, or they'll fight over `transcription_status`.

## Install and build

```bash
npm install
# Generate the native Android project. Required because we use react-native-call-log
# and react-native-receive-sharing-intent, which need native code.
npx expo prebuild --platform android

# Option A: run on a connected device (debug build with Dev Client)
npx expo run:android --device

# Option B: produce a sideloadable APK via EAS
npx eas build --profile preview --platform android
```

> The Expo **managed** workflow will not work — `read CallLog`, audio share intent receiver, and background foreground services need the prebuilt native project. Always run `prebuild` after editing `app.json`.

## On-device setup (first run)

1. Install the APK on your Android phone.
2. Sign in with the email-OTP flow.
3. Open Settings tab → tap **Request permissions** and grant: Call log, Storage / Audio, Contacts, Notifications.
4. In phone Settings → Apps → Calling → **Battery → Unrestricted**. This is required for background sync to survive Doze.
5. Make sure your dialer has **native call recording** enabled. Skip this if you use Google Dialer — see below.

### Google Dialer path

Google's policy blocks third-party apps from auto-reading its recordings. After a call:
1. Open Phone → Recents → tap the call → tap the recording → **Share**.
2. Choose **Calling** from the share sheet. The app uploads and pairs it to the matching call log entry automatically.

## How sync works

- A background task (default every 15 min) reads new CallLog entries since the last cursor, scans the OEM recording folders for files newer than the cursor, pairs each recording to a call by filename digits or by closest timestamp, and uploads to Supabase Storage at `{user_id}/{device_id}/{call_id}.{ext}`.
- A Storage webhook (or the app's "re-transcribe" button) invokes the `transcribe-call` Edge Function, which calls the configured provider and writes the transcript back to the `calls` row.

## Transcription

This project uses **local whisper.cpp on your Mac** (small model). Setup:

```bash
brew install whisper-cpp ffmpeg
mkdir -p tools/local-transcriber/models
curl -L -o tools/local-transcriber/models/ggml-small.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
cd tools/local-transcriber
npm install
cp .env.example .env  # fill in SUPABASE_SERVICE_ROLE_KEY
npm start             # long-running poll loop
```

See [`tools/local-transcriber/README.md`](tools/local-transcriber/README.md) for tuning, language settings, and the security note.

If you'd rather use a cloud provider, the Edge Function in `supabase/functions/transcribe-call/` ships with Deepgram, OpenAI Whisper, and AssemblyAI adapters — set `TRANSCRIPTION_PROVIDER` and the relevant `*_API_KEY` secret, deploy, and add the Storage webhook. Don't run both at the same time.

## Verifying end-to-end

1. Sign in. Confirm a row appears in `profiles`.
2. Grant permissions; accept battery exemption.
3. Make a 10–20 s test call with native recording on.
4. Open Settings → **Sync now**.
5. Expect:
   - A row in `calls` with the right number, direction, duration.
   - The audio file at `call-recordings/{user_id}/{device_id}/{call_id}.m4a`.
   - `transcription_status` flips `pending → processing → done`.
   - Calls tab shows the transcript; Call detail page plays the audio.
6. From Google Dialer, share a recording into the app → row should update with `recording_source = 'manual_share'`.

## Repo layout

```
app/                  Expo Router screens
src/                  Mobile app code (sync, share intent, supabase client)
supabase/migrations/  SQL schema + RLS + bucket
supabase/functions/   Edge Functions (transcribe-call + provider adapters)
```

## Open items / future work

- Sync interval is fixed at 15 min; expose as a setting.
- No audio-format normalization — files are uploaded as-is. If a provider rejects `.amr` later, add a normalization step.
- Web dashboard (Vite + React) reading the same Supabase project is planned as a follow-up; same schema works unchanged.
