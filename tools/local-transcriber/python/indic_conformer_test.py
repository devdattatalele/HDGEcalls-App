"""
Benchmark AI4Bharat IndicConformer-600M (multilingual) on the user's
Marathi sample. Loads via transformers (trust_remote_code) per the model
card's official invocation.

Conformer + CTC is fundamentally different from Whisper — no autoregressive
decoder, no temperature fallback retry chain. That's the architectural
reason this should run fast where every Whisper attempt failed.

Usage:
  python python/indic_conformer_test.py /path/to/audio.wav [language=mr] [decoder=ctc|rnnt]
"""

from __future__ import annotations
import json
import os
import sys
import time

import librosa
import numpy as np
import torch
from transformers import AutoModel


def main():
    if len(sys.argv) < 2:
        print(
            "usage: indic_conformer_test.py <audio_wav> [language=mr] [decoder=ctc]",
            file=sys.stderr,
        )
        sys.exit(2)
    audio_path = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else "mr"
    decoder = sys.argv[3] if len(sys.argv) > 3 else "ctc"
    model_id = os.environ.get(
        "INDIC_CONFORMER_MODEL", "ai4bharat/indic-conformer-600m-multilingual"
    )

    print(
        f"[ic] model={model_id} language={language} decoder={decoder}",
        file=sys.stderr,
    )

    t0 = time.time()
    model = AutoModel.from_pretrained(model_id, trust_remote_code=True)
    load_sec = time.time() - t0
    print(f"[ic] loaded in {load_sec:.1f}s", file=sys.stderr)

    audio_np, _ = librosa.load(audio_path, sr=16000, mono=True)
    wav = torch.from_numpy(audio_np).unsqueeze(0)
    audio_sec = wav.shape[-1] / 16000.0

    t1 = time.time()
    transcript = model(wav, language, decoder)
    run_sec = time.time() - t1
    rtf = run_sec / max(audio_sec, 0.001)

    print(
        f"[ic] inference {run_sec:.1f}s on {audio_sec:.1f}s audio (RTF {rtf:.2f}x)",
        file=sys.stderr,
    )

    print(
        json.dumps(
            {
                "model": model_id,
                "language": language,
                "decoder": decoder,
                "load_sec": round(load_sec, 2),
                "run_sec": round(run_sec, 2),
                "audio_sec": round(audio_sec, 2),
                "rtf": round(rtf, 3),
                "transcript": str(transcript).strip(),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
