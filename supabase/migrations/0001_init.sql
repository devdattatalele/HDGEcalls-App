-- Calling: initial schema
-- Run via Supabase SQL editor or `supabase db push`.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles: 1:1 with auth.users
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_upsert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Auto-create profile row on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- devices
-- ---------------------------------------------------------------------------
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  android_id text not null,
  label text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, android_id)
);

alter table public.devices enable row level security;

create policy "devices_owner_all" on public.devices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- calls
-- ---------------------------------------------------------------------------
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  phone_number text,
  contact_name text,
  direction text check (direction in ('incoming','outgoing','missed','rejected')),
  started_at timestamptz not null,
  duration_sec int not null default 0,
  call_log_id text,
  recording_storage_path text,
  recording_mime text,
  recording_source text check (recording_source in ('auto','manual_share')),
  transcription_status text not null default 'pending'
    check (transcription_status in ('pending','processing','done','failed','skipped')),
  transcript text,
  transcript_segments jsonb,
  transcript_provider text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, call_log_id)
);

create index if not exists calls_user_started_idx
  on public.calls (user_id, started_at desc);
create index if not exists calls_status_idx
  on public.calls (transcription_status) where transcription_status = 'pending';

alter table public.calls enable row level security;

create policy "calls_owner_all" on public.calls
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists calls_touch_updated_at on public.calls;
create trigger calls_touch_updated_at
  before update on public.calls
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- transcription_errors (diagnostic log)
-- ---------------------------------------------------------------------------
create table if not exists public.transcription_errors (
  id bigserial primary key,
  call_id uuid references public.calls(id) on delete cascade,
  provider text,
  error text,
  created_at timestamptz not null default now()
);
alter table public.transcription_errors enable row level security;
create policy "tx_errors_owner_select" on public.transcription_errors
  for select using (
    exists (
      select 1 from public.calls c
      where c.id = transcription_errors.call_id and c.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Storage: call-recordings bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('call-recordings', 'call-recordings', false)
on conflict (id) do nothing;

-- Object path convention: {user_id}/{device_id}/{call_id}.{ext}
-- Allow owners to read/write only their own folder.
create policy "recordings_owner_read" on storage.objects
  for select using (
    bucket_id = 'call-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "recordings_owner_write" on storage.objects
  for insert with check (
    bucket_id = 'call-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "recordings_owner_update" on storage.objects
  for update using (
    bucket_id = 'call-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "recordings_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'call-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
