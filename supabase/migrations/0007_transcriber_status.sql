-- Heartbeat / status table for the local Whisper worker(s).
--
-- The worker has the Supabase service-role key already (to pull jobs and write
-- transcripts), so the simplest place to publish its own liveness is right
-- here. The dashboard's "Transcriber online" pill reads from this table via
-- the FastAPI backend.
--
-- This replaces the Cloudflare-tunnelled HTTP /status endpoint — Cloudflare
-- Tunnel requires Connector:Write on the Cloudflare account, which the
-- account owner here doesn't have.

create table if not exists public.transcriber_status (
  worker_id      text primary key,
  provider       text,
  started_at     timestamptz,
  last_heartbeat timestamptz not null default now(),
  last_pass_at   timestamptz,
  jobs_in_flight int  not null default 0,
  jobs_done_today int not null default 0,
  jobs_failed_today int not null default 0,
  last_error     text
);

create index if not exists transcriber_status_heartbeat_idx
  on public.transcriber_status (last_heartbeat desc);

alter table public.transcriber_status enable row level security;

-- Only the service-role key writes (the worker). The FastAPI backend reads
-- via service-role too. No anon/authenticated policies needed.
