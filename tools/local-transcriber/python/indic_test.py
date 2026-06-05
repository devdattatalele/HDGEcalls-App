"""
Quick benchmark: run Whisper large-v3 on Apple Silicon GPU (MPS) for a
Marathi/Hindi/English sample audio file. Compares vs the whisper.cpp CPU
result we already have.

This is the test path before we wire a permanent backend — we want to know:
  1. Does MPS work without crashes? (whisper.cpp Metal had a residency-set bug)
  2. What's the realtime ratio?
  3. Does the model produce coherent Marathi like our CPU test did?

Usage:
  python python/indic_test.py /path/to/audio.wav [language]
"""

from __future__ import annotations
import json
import os
import sys
import time

import torch
from transformers import pipeline


def main():
    if len(sys.argv) < 2:
        print("usage: indic_test.py <audio_wav> [language=mr]", file=sys.stderr)
        sys.exit(2)
    audio = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else "mr"
    model_id = os.environ.get("INDIC_MODEL", "openai/whisper-large-v3")

    if torch.backends.mps.is_available():
        device = "mps"
        torch_dtype = torch.float16
    elif torch.cuda.is_available():
        device = "cuda"
        torch_dtype = torch.float16
    else:
        device = "cpu"
        torch_dtype = torch.float32
    print(f"[indic] device={device} dtype={torch_dtype} model={model_id}", file=sys.stderr)

    t0 = time.time()
    asr = pipeline(
        "automatic-speech-recognition",
        model=model_id,
        torch_dtype=torch_dtype,
        device=device,
        chunk_length_s=30,
        return_timestamps=True,
    )
    load_sec = time.time() - t0
    print(f"[indic] model loaded in {load_sec:.1f}s", file=sys.stderr)

    t1 = time.time()
    result = asr(
        audio,
        generate_kwargs={"language": language, "task": "transcribe"},
    )
    run_sec = time.time() - t1
    print(f"[indic] inference {run_sec:.1f}s", file=sys.stderr)

    chunks = result.get("chunks") or []
    print(json.dumps(
        {
            "language": language,
            "device": device,
            "model": model_id,
            "load_sec": load_sec,
            "run_sec": run_sec,
            "text": result.get("text", "").strip(),
            "chunks": [
                {
                    "start": (c.get("timestamp") or (None, None))[0],
                    "end": (c.get("timestamp") or (None, None))[1],
                    "text": (c.get("text") or "").strip(),
                }
                for c in chunks
            ],
        },
        ensure_ascii=False,
        indent=2,
    ))


if __name__ == "__main__":
    main()
