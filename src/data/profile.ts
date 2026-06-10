import { supabase } from '../supabase/client';

export type Plan = 'free' | 'starter' | 'pro' | 'business';

export interface ProfileRow {
  id: string;
  display_name: string | null;
  full_name: string | null;
  phone: string | null;
  country: string | null;
  company_name: string | null;
  company_role: string | null;
  company_size: string | null;
  company_website: string | null;
  onboarded_at: string | null;
  plan: Plan;
  monthly_recording_limit: number;
  monthly_token_limit: number;
}

export type ProfileEditable = Pick<
  ProfileRow,
  | 'full_name'
  | 'phone'
  | 'country'
  | 'company_name'
  | 'company_role'
  | 'company_size'
  | 'company_website'
>;

export interface ProfileUsage {
  user_id: string;
  plan: Plan;
  monthly_recording_limit: number;
  monthly_token_limit: number;
  recordings_used_this_month: number;
  tokens_used_this_month: number;
}

export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, display_name, full_name, phone, country, company_name, company_role, company_size, company_website, onboarded_at, plan, monthly_recording_limit, monthly_token_limit',
    )
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as ProfileRow) ?? null;
}

export async function updateProfile(
  userId: string,
  patch: Partial<ProfileEditable>,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId);
  if (error) throw error;
}

export async function fetchUsage(userId: string): Promise<ProfileUsage | null> {
  const { data, error } = await supabase
    .from('profile_usage')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as ProfileUsage) ?? null;
}

export interface MonthlyMinutes {
  recording_minutes: number;
  transcription_minutes: number;
}

/**
 * Compute month-to-date minutes from the `calls` table directly. Aligns with
 * how the website's billing page reports usage (calls.hdgelabs.com).
 *  - Recording minutes: sum(duration_sec)/60 of synced calls (recording exists)
 *  - Transcription minutes: same sum but only where transcription_status='done'
 */
export async function fetchMonthlyMinutes(userId: string): Promise<MonthlyMinutes> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const iso = monthStart.toISOString();

  const { data, error } = await supabase
    .from('calls')
    .select('duration_sec, transcription_status, recording_storage_path')
    .eq('user_id', userId)
    .gte('started_at', iso);
  if (error) throw error;
  let recSec = 0;
  let txSec = 0;
  for (const row of (data ?? []) as Array<{
    duration_sec: number | null;
    transcription_status: string | null;
    recording_storage_path: string | null;
  }>) {
    const d = row.duration_sec ?? 0;
    if (row.recording_storage_path) recSec += d;
    if (row.transcription_status === 'done') txSec += d;
  }
  return {
    recording_minutes: recSec / 60,
    transcription_minutes: txSec / 60,
  };
}
