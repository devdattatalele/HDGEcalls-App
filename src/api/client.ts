import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase/client';

export const HDGE_API_BASE =
  process.env.EXPO_PUBLIC_HDGE_API_URL?.trim() ||
  'https://api.calls.hdgelabs.com';

const ME_CACHE_KEY = 'hdgecalls.api.me';

export interface CompanyBrand {
  id: string;
  name: string;
  logo_url: string | null;
  plan: 'free' | 'starter' | 'pro' | 'business';
  monthly_recording_limit: number;
  monthly_token_limit: number;
  industry?: string | null;
  website?: string | null;
}

export interface MeResponse {
  user: {
    id: string;
    email: string | null;
    label: string | null;
  };
  company: CompanyBrand;
}

export interface SignedUpload {
  url: string;
  recording_storage_path: string;
  company_id: string;
  expires_in: number;
}

async function bearer(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await bearer();
  if (!token) throw new Error('not_signed_in');

  const res = await fetch(`${HDGE_API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HDGE_API ${res.status} ${path}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

function isMeResponse(x: unknown): x is MeResponse {
  if (!x || typeof x !== 'object') return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.user === 'object' &&
    v.user !== null &&
    typeof v.company === 'object' &&
    v.company !== null
  );
}

/**
 * Fetches the signed-in team member's profile + their company branding.
 * Caches the result so the company name/logo can still render offline.
 * Rejects if the server returned a payload that doesn't match the expected
 * shape — the call site should treat that the same as a network failure.
 */
export async function fetchMe(): Promise<MeResponse> {
  const raw = await call<unknown>('/v1/app/me');
  if (!isMeResponse(raw)) {
    throw new Error(
      'HDGE_API /v1/app/me returned an unexpected payload shape',
    );
  }
  try {
    await AsyncStorage.setItem(ME_CACHE_KEY, JSON.stringify(raw));
  } catch {
    // ignore — cache is best-effort
  }
  return raw;
}

export async function loadCachedMe(): Promise<MeResponse | null> {
  try {
    const raw = await AsyncStorage.getItem(ME_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isMeResponse(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearCachedMe(): Promise<void> {
  await AsyncStorage.removeItem(ME_CACHE_KEY).catch(() => undefined);
}

/**
 * Asks the website backend for a presigned PUT URL to upload the next
 * recording. The returned `recording_storage_path` is the canonical path
 * the calls row will reference; `company_id` lets the client populate the
 * denormalised column on insert.
 */
export async function signRecordingUpload(args: {
  callId: string;
  phoneNumber: string | null;
  startedAtMs: number;
  ext: string;
}): Promise<SignedUpload> {
  return call<SignedUpload>('/v1/app/uploads/sign', {
    method: 'POST',
    body: JSON.stringify({
      call_id: args.callId,
      phone_number: args.phoneNumber,
      started_at: new Date(args.startedAtMs).toISOString(),
      ext: args.ext,
    }),
  });
}
