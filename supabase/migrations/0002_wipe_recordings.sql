-- Phase 2 reset: drop all test data so we don't carry forward the old
-- {user_id}/{device_id}/{call_id} storage paths or the noise rows from the
-- previous sync model that inserted a call row even when no recording was
-- paired. Run once in the Supabase SQL editor.
--
-- Storage objects are NOT cleared by SQL. After running this:
--   Supabase Studio → Storage → call-recordings → select all → Delete.
--
-- Also (one-time): Supabase Studio → Authentication → Providers → Email →
--   uncheck "Confirm email", so the new email+password sign-up works without
--   a confirmation link.

truncate public.transcription_errors restart identity cascade;
truncate public.calls restart identity cascade;
truncate public.devices restart identity cascade;
