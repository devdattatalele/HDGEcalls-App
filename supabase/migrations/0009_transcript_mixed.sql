-- Layer 3 of the transcription pipeline: a code-switched "mixed" transcript
-- produced by whisper.cpp running in parallel with the IndicConformer
-- daemon. Where Layer 1 (IndicConformer) drops English code-switches and
-- Layer 2 (IndicTrans2) summarises them away, Layer 3 keeps English words
-- like "meeting", "UI", "system", "discussion" intact alongside the
-- transliterated Hindi/Marathi context.
--
-- Trade-offs: Whisper's Marathi accuracy is lower than IndicConformer's, so
-- this is NOT the preferred reading mode — it's the fallback when the
-- manager needs to verify a specific English term that the other layers
-- have dropped.

alter table public.calls
  add column if not exists transcript_mixed text;
