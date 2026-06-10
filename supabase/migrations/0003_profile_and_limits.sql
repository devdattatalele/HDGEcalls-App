-- HDGEcalls Phase 3: profile fields + plan/limit columns + usage view.
-- Run once via the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- profiles: account + company fields (user-editable)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists full_name text,
  add column if not exists phone text,
  add column if not exists country text,
  add column if not exists company_name text,
  add column if not exists company_role text,
  add column if not exists company_size text,
  add column if not exists company_website text,
  add column if not exists onboarded_at timestamptz;

-- ---------------------------------------------------------------------------
-- Plan + usage limits. Writes only from service role (HDGElabs website).
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists plan text not null default 'free',
  add column if not exists monthly_recording_limit int not null default 50,
  add column if not exists monthly_token_limit int not null default 60000,
  add column if not exists limits_updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_plan_check'
  ) then
    alter table public.profiles
      add constraint profiles_plan_check
      check (plan in ('free','starter','pro','business'));
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- profile_usage view: current-month counters the app reads.
-- ---------------------------------------------------------------------------
create or replace view public.profile_usage as
select
  p.id as user_id,
  p.plan,
  p.monthly_recording_limit,
  p.monthly_token_limit,
  coalesce((
    select count(*) from public.calls c
    where c.user_id = p.id
      and c.recording_storage_path is not null
      and c.started_at >= date_trunc('month', now())
  ), 0)::int as recordings_used_this_month,
  coalesce((
    select sum(c.duration_sec) from public.calls c
    where c.user_id = p.id
      and c.transcription_status = 'done'
      and c.started_at >= date_trunc('month', now())
  ), 0)::int as tokens_used_this_month
from public.profiles p;

alter view public.profile_usage set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- Tighten the update policy: plan / limits are off-limits from the client.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_update_own_safe_fields" on public.profiles;

create policy "profiles_update_own_safe_fields" on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and plan = (select plan from public.profiles where id = auth.uid())
    and monthly_recording_limit = (select monthly_recording_limit from public.profiles where id = auth.uid())
    and monthly_token_limit = (select monthly_token_limit from public.profiles where id = auth.uid())
  );
