"""
Long-running AI4Bharat IndicConformer + IndicTrans2 daemon — two-layer
transcription pipeline.

Layer 1: IndicConformer-600M → native-script ASR output (Devanagari for
         Marathi/Hindi, Tamil script for Tamil, etc.).
Layer 2: IndicTrans2-distilled-200M → proper English translation of the
         native-script transcript.

The Node worker spawns this once at startup and keeps it alive. Per-call
protocol is one JSON line in on stdin, one JSON line out on stdout.

Request line:
  {"audio": "/abs/path/to/audio.wav", "language": "mr", "decoder": "ctc"}

Response line (on success):
  {
    "ok": true,
    "transcript": "हॅलो हॅलो ह मी बोलतो...",        # native script, Layer 1
    "transcript_english": "Hello hello, I am ...",  # English, Layer 2
    "language": "mr",
    "decoder": "ctc",
    "audio_sec": 62.5,
    "asr_sec": 11.8,
    "translate_sec": 1.4,
    "rtf": 0.21
  }

Response line on failure:
  {"ok": false, "error": "..."}

A line "ping" returns "pong" — used to detect a dead daemon.
"""

from __future__ import annotations
import json
import os
import sys
import time
import traceback

import librosa
import torch
from transformers import AutoModel, AutoModelForSeq2SeqLM, AutoTokenizer

try:
    from IndicTransToolkit.processor import IndicProcessor  # noqa: F401
except Exception:  # noqa: BLE001 — fallback name used in some versions
    from IndicTransToolkit import IndicProcessor


ASR_MODEL_ID = os.environ.get(
    "INDIC_CONFORMER_MODEL", "ai4bharat/indic-conformer-600m-multilingual"
)
MT_MODEL_ID = os.environ.get(
    "INDIC_TRANS_MODEL", "ai4bharat/indictrans2-indic-en-dist-200M"
)
DEFAULT_LANGUAGE = os.environ.get("INDIC_LANGUAGE", "mr")
DEFAULT_DECODER = os.environ.get("INDIC_DECODER", "ctc")
TRANSLATE = (os.environ.get("INDIC_TRANSLATE_TO_ENGLISH", "1") != "0")
MT_BEAM = int(os.environ.get("INDIC_TRANS_BEAM", "5"))
MT_MAX_LEN = int(os.environ.get("INDIC_TRANS_MAX_LEN", "512"))
# Anything longer than INDIC_ASR_CHUNK_SEC gets split into windows because
# the IndicConformer ONNX encoder has no built-in chunking — positional
# embeddings overflow on long inputs ("2113 by 7113" broadcast error).
ASR_CHUNK_SEC = float(os.environ.get("INDIC_ASR_CHUNK_SEC", "60"))
ASR_CHUNK_OVERLAP_SEC = float(os.environ.get("INDIC_ASR_CHUNK_OVERLAP_SEC", "1.5"))


# IndicTrans2 source-language tags. Keys are the ISO-639-1 codes the
# IndicConformer side accepts; values are the script-aware tags
# IndicTrans2 expects (FLORES-200 style).
INDICTRANS_SRC_LANG = {
    "as": "asm_Beng",
    "bn": "ben_Beng",
    "brx": "brx_Deva",
    "doi": "doi_Deva",
    "gu": "guj_Gujr",
    "hi": "hin_Deva",
    "kn": "kan_Knda",
    "kok": "gom_Deva",
    "ks": "kas_Arab",
    "mai": "mai_Deva",
    "ml": "mal_Mlym",
    "mni": "mni_Beng",
    "mr": "mar_Deva",
    "ne": "npi_Deva",
    "or": "ory_Orya",
    "pa": "pan_Guru",
    "sa": "san_Deva",
    "sat": "sat_Olck",
    "sd": "snd_Arab",
    "ta": "tam_Taml",
    "te": "tel_Telu",
    "ur": "urd_Arab",
}
TGT_LANG = "eng_Latn"


def log(msg: str) -> None:
    """All log output goes to stderr; stdout is reserved for JSON responses."""
    print(f"[indic-daemon] {msg}", file=sys.stderr, flush=True)


def main() -> None:
    log(f"loading ASR model={ASR_MODEL_ID}")
    t0 = time.time()
    asr_model = AutoModel.from_pretrained(ASR_MODEL_ID, trust_remote_code=True)
    log(f"ASR loaded in {time.time() - t0:.1f}s")

    mt_tokenizer = None
    mt_model = None
    mt_processor = None
    if TRANSLATE:
        log(f"loading translation model={MT_MODEL_ID}")
        t1 = time.time()
        mt_tokenizer = AutoTokenizer.from_pretrained(
            MT_MODEL_ID, trust_remote_code=True
        )
        mt_model = AutoModelForSeq2SeqLM.from_pretrained(
            MT_MODEL_ID, trust_remote_code=True
        )
        mt_model.eval()
        mt_processor = IndicProcessor(inference=True)
        log(f"translation loaded in {time.time() - t1:.1f}s")
    else:
        log("translation disabled (INDIC_TRANSLATE_TO_ENGLISH=0)")

    log("ready")
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
            sys.stdout.write(
                json.dumps({"ok": False, "error": f"bad json: {exc}"}) + "\n"
            )
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
            audio_sec = len(audio_np) / 16000.0

            # Layer 1 — ASR. Chunk long files so the ONNX encoder's
            # positional embeddings don't overflow.
            t_asr0 = time.time()
            transcript = asr_transcribe_chunked(
                asr_model, audio_np, language, decoder
            )
            asr_sec = time.time() - t_asr0

            # Layer 2 — translate native script to English (best-effort;
            # if translation fails we still ship Layer 1).
            transcript_english = ""
            translate_sec = 0.0
            translate_error = None
            if TRANSLATE and mt_model is not None and transcript:
                src_tag = INDICTRANS_SRC_LANG.get(language)
                if not src_tag:
                    translate_error = f"no IndicTrans2 tag for language {language!r}"
                else:
                    try:
                        t_mt0 = time.time()
                        transcript_english = translate(
                            transcript,
                            src_tag,
                            mt_tokenizer,
                            mt_model,
                            mt_processor,
                        )
                        translate_sec = time.time() - t_mt0
                    except Exception as exc:  # noqa: BLE001
                        translate_error = str(exc)[:300]
                        log(f"translate failed: {translate_error}")

            total = asr_sec + translate_sec
            out = {
                "ok": True,
                "transcript": transcript,
                "transcript_english": transcript_english,
                "translate_error": translate_error,
                "language": language,
                "decoder": decoder,
                "asr_model": ASR_MODEL_ID,
                "translate_model": MT_MODEL_ID if TRANSLATE else None,
                "audio_sec": round(audio_sec, 2),
                "asr_sec": round(asr_sec, 2),
                "translate_sec": round(translate_sec, 2),
                "run_sec": round(total, 2),
                "rtf": round(total / max(audio_sec, 0.001), 3),
            }
            sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
            sys.stdout.flush()
        except Exception as exc:
            log(f"transcribe failed: {exc}\n{traceback.format_exc()}")
            sys.stdout.write(
                json.dumps({"ok": False, "error": str(exc)[:500]}) + "\n"
            )
            sys.stdout.flush()


def asr_transcribe_chunked(
    model,
    audio_np,
    language: str,
    decoder: str,
):
    """Run IndicConformer over audio that may be longer than the encoder
    can handle in one pass.

    The official ONNX export has no internal chunker — long inputs blow up
    with a positional-embedding broadcast mismatch ("2113 by 7113"). We
    split into fixed windows (default 60 s) with a small overlap (1.5 s)
    to avoid mid-word splits, then concatenate the per-chunk transcripts.
    """
    sr = 16000
    total_samples = len(audio_np)
    chunk_samples = int(ASR_CHUNK_SEC * sr)
    overlap_samples = int(ASR_CHUNK_OVERLAP_SEC * sr)

    if total_samples <= chunk_samples:
        wav = torch.from_numpy(audio_np).unsqueeze(0)
        return str(model(wav, language, decoder)).strip()

    parts: list[str] = []
    start = 0
    while start < total_samples:
        end = min(start + chunk_samples, total_samples)
        chunk = audio_np[start:end]
        # Skip a final sliver that's too short — it'll already be covered
        # by the previous chunk's overlap.
        if end > start + sr // 2:  # at least 0.5 s
            wav = torch.from_numpy(chunk).unsqueeze(0)
            try:
                piece = str(model(wav, language, decoder)).strip()
            except Exception as exc:  # noqa: BLE001
                log(
                    f"chunk [{start / sr:.1f}-{end / sr:.1f}s] failed: {exc}"
                )
                piece = ""
            if piece:
                parts.append(piece)
        if end >= total_samples:
            break
        start = end - overlap_samples

    return " ".join(p for p in parts if p).strip()


def translate(
    text: str,
    src_tag: str,
    tokenizer,
    model,
    processor,
) -> str:
    """Translate one native-script transcript to English via IndicTrans2.

    Uses AI4Bharat's `IndicProcessor` for the language-tag prepending,
    normalisation, and post-decode cleanup. Long transcripts are split on
    sentence-ish punctuation so each chunk fits in the model's 256-token
    window; chunks are translated then joined.
    """
    chunks = _split_for_mt(text)
    # Run all chunks through the processor in a single batch — it handles
    # normalisation + adds the "<src> <tgt> ..." prefix.
    batch = processor.preprocess_batch(chunks, src_lang=src_tag, tgt_lang=TGT_LANG)
    inputs = tokenizer(
        batch,
        truncation=True,
        padding="longest",
        return_tensors="pt",
        return_attention_mask=True,
    )
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            use_cache=True,
            min_length=0,
            max_length=MT_MAX_LEN,
            num_beams=MT_BEAM,
            num_return_sequences=1,
        )
    with tokenizer.as_target_tokenizer():
        decoded = tokenizer.batch_decode(
            outputs.detach().cpu().tolist(),
            skip_special_tokens=True,
            clean_up_tokenization_spaces=True,
        )
    final = processor.postprocess_batch(decoded, lang=TGT_LANG)
    return " ".join(p.strip() for p in final if p and p.strip()).strip()


_MT_CHUNK_PUNCT = (".", "?", "!", "।", "॥")


def _split_for_mt(text: str, max_chars: int = 350) -> list[str]:
    """Split a long transcript into sentence-ish chunks for IndicTrans2.

    IndicTrans2's 256-token window covers ~300-400 characters of Indic text;
    we batch one sentence at a time, with a backstop max length so a single
    runaway sentence still fits.
    """
    out: list[str] = []
    buf = ""
    for ch in text:
        buf += ch
        if ch in _MT_CHUNK_PUNCT and len(buf.strip()) >= 20:
            out.append(buf.strip())
            buf = ""
        elif len(buf) >= max_chars:
            out.append(buf.strip())
            buf = ""
    if buf.strip():
        out.append(buf.strip())
    return out or [text]


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except KeyboardInterrupt:
        pass
