"""
Benchmark faster-whisper (CTranslate2) on the user's Marathi sample.

Why this instead of transformers:
  - CTranslate2 is purpose-built for Whisper inference; typically 4-8x faster
    than HF transformers on CPU for the same model.
  - Has Whisper-native VAD built in (Silero), VAD-first decoding suppresses
    most hallucination loops without us writing extra filters.
  - Same Whisper model weights — quality should match transformers, just
    with the optimised runtime.

Usage:
  python python/fw_test.py /path/to/audio.wav [language]
"""

from __future__ import annotations
import json
import os
import sys
import time

from faster_whisper import WhisperModel


def main():
    if len(sys.argv) < 2:
        print("usage: fw_test.py <audio_wav> [language=mr]", file=sys.stderr)
        sys.exit(2)
    audio = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else "mr"
    model_id = os.environ.get("FW_MODEL", "large-v3")
    compute_type = os.environ.get("FW_COMPUTE_TYPE", "int8")
    threads = int(os.environ.get("FW_THREADS", "8"))

    print(
        f"[fw] model={model_id} compute={compute_type} threads={threads} lang={language}",
        file=sys.stderr,
    )

    t0 = time.time()
    model = WhisperModel(
        model_id,
        device="cpu",
        compute_type=compute_type,
        cpu_threads=threads,
    )
    load_sec = time.time() - t0
    print(f"[fw] loaded in {load_sec:.1f}s", file=sys.stderr)

    t1 = time.time()
    segments_iter, info = model.transcribe(
        audio,
        language=language,
        beam_size=5,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500, "threshold": 0.6},
        condition_on_previous_text=False,
        log_prob_threshold=-0.6,
    )
    segments = []
    for s in segments_iter:
        segments.append(
            {
                "start": round(s.start, 2),
                "end": round(s.end, 2),
                "text": (s.text or "").strip(),
            }
        )
    run_sec = time.time() - t1

    audio_sec = info.duration
    rtf = run_sec / max(audio_sec, 0.001)

    print(
        f"[fw] inference {run_sec:.1f}s on {audio_sec:.1f}s audio (RTF {rtf:.2f}x)",
        file=sys.stderr,
    )
    print(
        json.dumps(
            {
                "model": model_id,
                "compute_type": compute_type,
                "language": language,
                "language_probability": info.language_probability,
                "audio_sec": audio_sec,
                "load_sec": round(load_sec, 2),
                "run_sec": round(run_sec, 2),
                "rtf": round(rtf, 3),
                "text": " ".join(s["text"] for s in segments).strip(),
                "segments": segments,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
