import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { supabase } from '../supabase/client';

const STORAGE_DEVICE_ID_KEY = 'calling.android_id';

/** Stable per-install Android identifier. */
export async function getAndroidId(): Promise<string> {
  if (Platform.OS !== 'android') return 'non-android';
  // expo-application 5.x exposes getAndroidId() synchronously and returns ''
  // (not null) when unavailable. Fall back to applicationId in that case.
  try {
    const id = Application.getAndroidId();
    if (id) return id;
  } catch {
    // ignore — fall through to applicationId
  }
  return Application.applicationId ?? 'unknown';
}

/** Ensures a `devices` row exists for this user+phone; returns its id. */
export async function ensureDeviceRow(args: {
  userId: string;
  label?: string;
}): Promise<string> {
  const androidId = await getAndroidId();

  const { data: existing, error: selErr } = await supabase
    .from('devices')
    .select('id')
    .eq('user_id', args.userId)
    .eq('android_id', androidId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing?.id) return existing.id;

  const { data: inserted, error: insErr } = await supabase
    .from('devices')
    .insert({
      user_id: args.userId,
      android_id: androidId,
      label: args.label ?? Platform.OS,
    })
    .select('id')
    .single();
  if (insErr) throw insErr;
  return inserted.id;
}

export async function updateDeviceLastSynced(deviceId: string): Promise<void> {
  await supabase
    .from('devices')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('id', deviceId);
}

// Local-storage key used by worker.ts for cursor persistence.
export { STORAGE_DEVICE_ID_KEY };
