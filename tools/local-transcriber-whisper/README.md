# local-transcriber-whisper — dev worker (free, self-host)

Sibling to `tools/local-transcriber/` (the Sarvam-backed demo worker).

Runs whisper.cpp `large-v3-turbo` locally on your Mac — no API costs.
Same TypeScript code as the Sarvam worker; only the `.env` differs.

## Layout

```
local-transcriber-whisper/
├── src/          →  symlink to ../local-transcriber/src        (one source of truth)
├── models/       →  symlink to ../local-transcriber/models     (whisper.cpp model)
├── node_modules/ →  symlink to ../local-transcriber/node_modules (npm deps)
├── .env          # your real env (NOT committed)
└── .env.example  # template — copy to .env, fill secrets
```

The symlinks let both workers share heavy artifacts and one source tree.

## First-time setup

```bash
cd "tools/local-transcriber-whisper"
cp .env.example .env
# Edit .env, copy these values from ../local-transcriber/.env :
#   SUPABASE_SERVICE_ROLE_KEY
#   GEMINI_API_KEY  (optional but worth it — fixes whisper's hallucinations)
```

That's it. No `npm install`, no model downloads — the symlinks pick everything
up from the Sarvam worker's existing install.

## Run

```bash
cd "tools/local-transcriber-whisper"
npm start
```

Expected startup:
```
[transcriber] starting — provider=whisper.cpp:ggml-large-v3-turbo-q5_0
[transcriber] backend=whisper worker_id=...
[transcriber] whisper language=hi romanize=1
[transcriber] llm cleanup: enabled (model=gemini-2.5-flash)
[transcriber] health server on :7778
```

## Switching between workers

Both workers poll the same Supabase `calls` table, so **run only one at a
time** or they'll race on claiming rows:

```bash
# For demo: stop whisper, start sarvam.
cd ../local-transcriber && npm start

# For dev: stop sarvam, start whisper.
cd ../local-transcriber-whisper && npm start
```

The two also bind different health ports (`7777` vs `7778`).
