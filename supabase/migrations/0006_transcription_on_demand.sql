-- Transcription becomes opt-in / on-demand.
--
-- Previously every recorded call defaulted to transcription_status='pending',
-- which the local Whisper worker would pick up automatically. For B2B billing
-- (per-minute transcription) the dashboard now decides which calls get
-- transcribed — the worker still polls for 'pending', but new rows start in
-- 'skipped' and the dashboard flips selected rows to 'pending' to enqueue.

alter table public.calls
  alter column transcription_status set default 'skipped';

update public.calls
  set transcription_status = 'skipped'
  where transcription_status = 'pending'
    and transcript is null;
