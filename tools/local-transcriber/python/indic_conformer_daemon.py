"""
Long-running AI4Bharat IndicConformer-600M transcription daemon.

The Node worker spawns this once at startup and keeps it alive for its
lifetime. Per-call protocol: write one JSON line to stdin, read one JSON
line back from stdout.

Why long-running: model load is ~8 seconds. We don't want to pay that on
every call.

Request line:
  {"audio": "/abs/path/to/audio.wav", "language": "mr", "decoder": "ctc"}

Response line (one of):
  {"ok": true, "transcript": "...", "rtf": 0.19, "audio_sec": 62.5, "run_sec": 11.8}
  {"ok": false, "error": "..."}

A line "ping" returns "pong" — used by the Node side to detect a dead
daemon on startup.
"""

from __future__ import annotations
import json
import os
import sys
import time
import traceback

import librosa
import numpy as np
import torch
from transformers import AutoModel


MODEL_ID = os.environ.get(
    "INDIC_CONFORMER_MODEL", "ai4bharat/indic-conformer-600m-multilingual"
)
DEFAULT_LANGUAGE = os.environ.get("INDIC_LANGUAGE", "mr")
DEFAULT_DECODER = os.environ.get("INDIC_DECODER", "ctc")


def log(msg: str) -> None:
    """All log output goes to stderr; stdout is reserved for JSON responses."""
    print(f"[indic-daemon] {msg}", file=sys.stderr, flush=True)


def main() -> None:
    log(f"loading model={MODEL_ID} (offline cache, ~8 s)")
    t0 = time.time()
    model = AutoModel.from_pretrained(MODEL_ID, trust_remote_code=True)
    log(f"loaded in {time.time() - t0:.1f}s — ready")
    sys.stdout.write(json.dumps({"event": "ready"}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        if line == "ping":
            sys.stdout.write("pong\n")
            sys.stdout.flush()
            continue
        try:
            req = json.loads(line)
        except Exception as exc:
            sys.stdout.write(json.dumps({"ok": False, "error": f"bad json: {exc}"}) + "\n")
            sys.stdout.flush()
            continue

        audio_path = req.get("audio")
        language = (req.get("language") or DEFAULT_LANGUAGE).strip()
        decoder = (req.get("decoder") or DEFAULT_DECODER).strip()

        if not audio_path or not os.path.exists(audio_path):
            sys.stdout.write(
                json.dumps({"ok": False, "error": f"audio not found: {audio_path}"})
                + "\n"
            )
            sys.stdout.flush()
            continue

        try:
            audio_np, _ = librosa.load(audio_path, sr=16000, mono=True)
            wav = torch.from_numpy(audio_np).unsqueeze(0)
            audio_sec = wav.shape[-1] / 16000.0

            t1 = time.time()
            transcript = model(wav, language, decoder)
            run_sec = time.time() - t1

            out = {
                "ok": True,
                "transcript": str(transcript).strip(),
                "language": language,
                "decoder": decoder,
                "model": MODEL_ID,
                "audio_sec": round(audio_sec, 2),
                "run_sec": round(run_sec, 2),
                "rtf": round(run_sec / max(audio_sec, 0.001), 3),
            }
            sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
            sys.stdout.flush()
        except Exception as exc:
            log(f"transcribe failed: {exc}\n{traceback.format_exc()}")
            sys.stdout.write(
                json.dumps({"ok": False, "error": str(exc)[:500]}) + "\n"
            )
            sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        # Node side closed stdin/stdout — clean exit.
        pass
    except KeyboardInterrupt:
        pass
