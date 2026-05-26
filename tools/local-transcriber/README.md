# Local Whisper transcriber (Mac)

Runs on your MacBook (Apple Silicon, Metal-accelerated). Polls Supabase for `calls` rows with `transcription_status = 'pending'` that have a recording, downloads the audio, transcribes it with **whisper.cpp** (small model), and writes the transcript back.

This replaces the Supabase Edge Function for transcription — keep your audio + the model entirely on your machine, no per-minute API fees. Reasonable for an M3 Air 16 GB; the small model uses ~500 MB RAM and transcribes faster than realtime on Apple Silicon.

## One-time setup

```bash
# 1. Install whisper.cpp + ffmpeg via Homebrew.
brew install whisper-cpp ffmpeg

# 2. Download the small GGML model (~500 MB).
mkdir -p tools/local-transcriber/models
curl -L -o tools/local-transcriber/models/ggml-small.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin

# 3. Install Node deps.
cd tools/local-transcriber
npm install

# 4. Configure env.
cp .env.example .env
#   → fill in SUPABASE_SERVICE_ROLE_KEY (sb_secret_...) from Supabase Studio.
#   → leave WHISPER_CLI / FFMPEG paths as-is unless `which whisper-cli` says otherwise.
```

Verify the binaries are where you expect:

```bash
which whisper-cli   # expect /opt/homebrew/bin/whisper-cli
which ffmpeg        # expect /opt/homebrew/bin/ffmpeg
```

## Run

```bash
# Long-running poll loop:
npm start

# One-pass mode (useful for testing):
npm run once
```

You should see something like:

```
[transcriber] starting — provider=whisper.cpp:ggml-small
[transcriber] polling every 10s (batch 2)
[transcriber] done 9c8a... (412 chars, 18 segs)
```

The `calls` row will flip `pending → processing → done` and the transcript will appear in the app.

## Tuning

- **Language**: set `WHISPER_LANGUAGE` in `.env` (`auto`, `en`, `hi`, …). `auto` is fine but `en` / `hi` is faster.
- **Threads**: whisper-cli uses 4 threads by default. M3 Air has 8 performance cores; pass `WHISPER_EXTRA_ARGS=--threads,8` for more speed.
- **Bigger model**: swap `WHISPER_MODEL` to `ggml-medium.bin` (~1.5 GB RAM) for better accuracy. Avoid `large` on 16 GB — it will swap.

## Important: don't also run the Edge Function

The Edge Function `transcribe-call` and this worker both try to set `transcription_status`. If you use this worker, **do not deploy the Edge Function** (or keep `TRANSCRIPTION_PROVIDER=stub` and don't set up the Storage webhook). One mechanism is enough.

The app's "Re-transcribe" button works either way — it just sets the row back to `pending`, and the worker will pick it up on the next poll.

## Security note

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. Keep it only on this machine. If it ever leaks (pasted to chat, committed, etc.), rotate it in Supabase Studio → Settings → API immediately.
