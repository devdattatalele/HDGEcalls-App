-- Two-layer transcription pipeline.
--
-- Layer 1 (existing `transcript`): native-script ASR output from
-- IndicConformer, then transliterated to Roman ("halo halo ha mi bolato").
-- Layer 2 (this new column): IndicTrans2 translation to proper English
-- ("Hello hello, I'm telling you...").
--
-- Both columns are populated together by the worker. The dashboard renders
-- them as tabs so the manager can flip between the language-true Roman
-- version and a comprehension-friendly English version of the same call.

alter table public.calls
  add column if not exists transcript_english text;
