import { File } from 'expo-file-system';
import { supabase } from '../supabase/client';
import { mimeForFilename } from './folderScan';

export const RECORDINGS_BUCKET = 'call-recordings';

/**
 * Collapse a phone number into a path-safe segment. Keeps digits and a leading
 * '+' for E.164 international numbers. Returns 'unknown' for blank or
 * placeholder values (private / withheld callers).
 */
export function sanitizePhoneForPath(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return 'unknown';
  if (/^(unknown|private|hidden|withheld|restricted)$/i.test(trimmed)) {
    return 'unknown';
  }
  const sign = trimmed.startsWith('+') ? '+' : '';
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return 'unknown';
  return (sign + digits).slice(0, 20);
}

/**
 * Upload a local recording file to Supabase Storage.
 *
 * Object path convention (Phase 2):
 *   {user_id}/by-number/{phoneNumber}/{YYYY-MM-DD}/{HHMMSS}_{callId8}.{ext}
 *
 * The {user_id} prefix is required by the Storage RLS policies in
 * supabase/migrations/0001_init.sql. Everything after is for human + website
 * readability — the website lists all recordings for a contact via a single
 * prefix scan.
 */
export async function uploadRecording(args: {
  userId: string;
  callId: string;
  phoneNumber: string | null;
  startedAtMs: number;
  localUri: string;
  filename: string;
}): Promise<{ path: string; mime: string }> {
  const ext = (args.filename.split('.').pop() ?? 'm4a').toLowerCase();
  const mime = mimeForFilename(args.filename);

  const dt = new Date(args.startedAtMs);
  const iso = dt.toISOString(); // "2026-05-27T14:30:52.000Z"
  const yyyy_mm_dd = iso.slice(0, 10);
  const HHmmss = iso.slice(11, 19).replace(/:/g, '');
  const numberSeg = sanitizePhoneForPath(args.phoneNumber);
  const callId8 = args.callId.replace(/-/g, '').slice(0, 8);

  const path = `${args.userId}/by-number/${numberSeg}/${yyyy_mm_dd}/${HHmmss}_${callId8}.${ext}`;

  const file = new File(args.localUri);
  const bytes = await file.bytes();

  const { error } = await supabase.storage
    .from(RECORDINGS_BUCKET)
    .upload(path, bytes, {
      contentType: mime,
      upsert: false,
    });

  if (error) throw error;
  return { path, mime };
}

export async function signedRecordingUrl(
  path: string,
  expiresInSec = 60 * 60,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(RECORDINGS_BUCKET)
    .createSignedUrl(path, expiresInSec);
  if (error) return null;
  return data.signedUrl;
}
