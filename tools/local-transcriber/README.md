# Local transcriber (Mac)

Runs on your MacBook. Polls Supabase for `calls` rows where the dashboard has
flipped `transcription_status = 'pending'`, downloads the audio, transcribes
it, and writes the result back. The website (`calls.hdgelabs.com`) is where
the team manager enqueues calls; this worker is the engine.

**Two backends**, pick one in `.env`:

| `TRANSCRIPTION_BACKEND=` | What | When |
|---|---|---|
| `sarvam` | Sarvam Saarika v2.5 batch API (diarized) | customer demo, paid (~$0.006/min) |
| `whisper` | whisper.cpp `large-v3-turbo` q5_0 on M3 | dev / offline, free |

A sibling folder `../local-transcriber-whisper/` runs the whisper backend with
its own `.env` (symlinks back to this folder's `src/`, `models/`,
`node_modules/`) so you can switch between them by `cd`-ing to the other
folder. Run only one at a time — they share the Supabase queue.

**Gemini cleanup** (optional, free tier): after either backend finishes, the
worker can run the transcript through `gemini-2.5-flash` to fix mangled tech
terms ("Pigma" → "Figma") and hallucinated phrases ("Hello Private Hospital").
Set `LLM_CLEANUP=1` + `GEMINI_API_KEY` to enable.

A small HTTP server on `:7777` exposes `/health` + `/status` so the dashboard
can show a "Transcriber online" pill. We tunnel that through Cloudflare
(`transcribe.calls.hdgelabs.com`) — see the cloudflared section below.

## One-time setup

```bash
# 1. Install whisper.cpp + ffmpeg + cloudflared via Homebrew.
brew install whisper-cpp ffmpeg cloudflared

# 2. Download the large-v3-turbo q5_0 transcription model (~574 MB) AND the
#    Silero VAD model (~870 KB). VAD pre-segments the audio so silence and
#    hold-music can't trigger Whisper hallucination loops on phone calls.
mkdir -p tools/local-transcriber/models
curl -L -o tools/local-transcriber/models/ggml-large-v3-turbo-q5_0.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
curl -L -o tools/local-transcriber/models/ggml-silero-v5.1.2.bin \
  https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin

# 3. Install Node deps.
cd tools/local-transcriber
npm install

# 4. Configure env.
cp .env.example .env
#   → fill in SUPABASE_SERVICE_ROLE_KEY (sb_secret_...) from Supabase Studio.
#   → keep WHISPER_CLI / FFMPEG paths as-is unless `which whisper-cli` differs.
```

Verify the binaries:

```bash
which whisper-cli   # /opt/homebrew/bin/whisper-cli
which ffmpeg        # /opt/homebrew/bin/ffmpeg
which cloudflared   # /opt/homebrew/bin/cloudflared
```

## Run (foreground, for local testing)

```bash
# Long-running poll loop:
npm start

# One-pass mode (for ad-hoc testing):
npm run once
```

You should see something like:

```
[transcriber] starting — provider=whisper.cpp:ggml-large-v3-turbo-q5_0
[transcriber] poll idle=10s active=3s batch=2 stuck=600s
[transcriber] health server on :7777
[transcriber] done 9c8a... (412 chars, 18 segs)
```

In another terminal:

```bash
curl -s http://localhost:7777/health
# {"ok":true,"provider":"whisper.cpp:ggml-large-v3-turbo-q5_0",...}

curl -s http://localhost:7777/status
# adds jobs_in_flight / jobs_done_today / last_error
```

## Cloudflare Tunnel (production wiring)

The dashboard hits `https://transcribe.calls.hdgelabs.com/status` to show the
"Transcriber online" pill. Setup (full doc:
`calls.hdgelabs.com/docs/cloudflared-transcriber.md`):

```bash
cloudflared tunnel login                       # browser → pick hdgelabs.com
cloudflared tunnel create hdge-transcriber
cloudflared tunnel route dns hdge-transcriber transcribe.calls.hdgelabs.com

# ~/.cloudflared/config.yml
#   tunnel: hdge-transcriber
#   credentials-file: /Users/<you>/.cloudflared/<UUID>.json
#   ingress:
#     - hostname: transcribe.calls.hdgelabs.com
#       service: http://localhost:7777
#     - service: http_status:404

cloudflared tunnel run hdge-transcriber        # test it
```

No transcription traffic flows through the tunnel — the worker pulls jobs
straight from Supabase. The tunnel only serves `/health` + `/status`, so a
tunnel outage doesn't stop transcription.

## Run as a service (launchd, auto-restart, auto-start on login)

```bash
cp launchd/com.hdgelabs.transcriber.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.hdgelabs.transcriber.plist

cp launchd/com.hdgelabs.cloudflared.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.hdgelabs.cloudflared.plist
```

Logs land at `/tmp/hdgecalls-transcriber.{log,err.log}` and
`/tmp/hdgecalls-cloudflared.{log,err.log}`.

To stop:

```bash
launchctl unload ~/Library/LaunchAgents/com.hdgelabs.transcriber.plist
launchctl unload ~/Library/LaunchAgents/com.hdgelabs.cloudflared.plist
```

> The plist files assume the repo at
> `/Users/dev16/Documents/calling/HDGEcalls app/tools/local-transcriber`.
> Edit `WorkingDirectory` if yours differs.

## Tuning

- **Language**: `WHISPER_LANGUAGE=auto` is the right default for Hinglish
  (Whisper auto-detects per 30 s window). Force `en` or `hi` only if calls are
  reliably single-language.
- **Speed**: `--threads,8,--flash-attn` is in `WHISPER_EXTRA_ARGS` by default.
  M3 has 8 performance cores; flash attention is faster + lower-memory.
- **Quality vs cost**: swap `WHISPER_MODEL` to `ggml-large-v3-q5_0.bin` (~1.1
  GB) for ~3% better Hinglish accuracy at ~4x slower runtime. Probably not
  worth it.
- **Batch / cadence**: `BATCH_SIZE=2` is conservative; raise to 4 if RAM is
  comfortable. `POLL_INTERVAL_ACTIVE_SEC=3` makes a queued batch drain
  quickly; `POLL_INTERVAL_SEC=10` is the idle cadence.

## Crash recovery

If the worker dies mid-job, any row stuck in `processing` longer than
`STUCK_PROCESSING_SEC` (default 600 s = 10 min) is bounced back to `pending`
on the next pass. The dashboard's Retry button does the same thing manually
(sets `failed` → `pending`).

## Security

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. Keep it only in `.env` on this
machine. If it ever leaks (pasted to chat, committed, etc.), rotate it in
Supabase Studio → Settings → API immediately.
