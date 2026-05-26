import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surface a loud error early — the rest of the app cannot function without these.
  // eslint-disable-next-line no-console
  console.error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Create .env (see .env.example) and rebuild the dev client.',
  );
}

export const supabase: SupabaseClient = createClient(url ?? '', anonKey ?? '', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export type Direction = 'incoming' | 'outgoing' | 'missed' | 'rejected';
export type TranscriptionStatus =
  | 'pending'
  | 'processing'
  | 'done'
  | 'failed'
  | 'skipped';

export interface CallRow {
  id: string;
  user_id: string;
  device_id: string;
  phone_number: string | null;
  contact_name: string | null;
  direction: Direction | null;
  started_at: string;
  duration_sec: number;
  call_log_id: string | null;
  recording_storage_path: string | null;
  recording_mime: string | null;
  recording_source: 'auto' | 'manual_share' | null;
  transcription_status: TranscriptionStatus;
  transcript: string | null;
  transcript_segments: unknown;
  transcript_provider: string | null;
  created_at: string;
  updated_at: string;
}
