# local-transcriber-indic — dev worker (free, self-host)

Sibling to `tools/local-transcriber/` (the Sarvam-backed demo worker).

This folder runs the **AI4Bharat IndicConformer + IndicTrans2 + whisper.cpp**
pipeline locally on your Mac. No API costs, full Three-layer output
(Roman / Mixed / English).

## Layout

```
local-transcriber-indic/
├── src/                   # same TypeScript as the Sarvam worker (copied, free
│                          # to edit independently while experimenting)
├── python/                # IndicConformer + IndicTrans2 daemon
├── .env                   # your real env (NOT committed)
├── .env.example           # template — copy to .env, fill secrets
├── .venv-indic   →  symlink to ../local-transcriber/.venv-indic  (5 GB Python deps)
├── models        →  symlink to ../local-transcriber/models         (1+ GB whisper.cpp model)
└── node_modules  →  symlink to ../local-transcriber/node_modules   (npm deps)
```

The symlinks let both workers share heavy artifacts so we don't duplicate
~5 GB on disk.

## First-time setup

```bash
cd "tools/local-transcriber-indic"

cp .env.example .env
# Edit .env, then copy these values from ../local-transcriber/.env :
#   SUPABASE_SERVICE_ROLE_KEY
#   HF_TOKEN
```

That's it — no `npm install`, no `pip install`, no model downloads. The
symlinks pick everything up from the Sarvam worker's existing install.

## Run

```bash
# In a terminal:
cd "tools/local-transcriber-indic"
npm start
```

Expected startup:
```
[transcriber] backend=indic worker_id=...
[transcriber] indic asr=ai4bharat/indic-conformer-600m-multilingual translate=1 lang=mr decoder=ctc romanize=1
[indic-py] [indic-daemon] ASR loaded in ~10s
[indic-py] [indic-daemon] translation loaded in ~3s
[indic-py] [indic-daemon] ready
```

## Switching between workers

Both workers poll the same Supabase `calls` table, so **run only one at a
time** otherwise they'll race on claiming rows:

```bash
# For demo: stop the indic worker, start sarvam.
cd ../local-transcriber && npm start

# For dev / iteration: stop the sarvam worker, start indic.
cd ../local-transcriber-indic && npm start
```

The two workers also bind different health ports (`7777` vs `7778`) so
they don't collide if you ever do want to run both side-by-side against
two different Supabase tenants.
