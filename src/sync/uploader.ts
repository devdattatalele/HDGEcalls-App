import { File } from 'expo-file-system';
import { supabase } from '../supabase/client';
import { mimeForFilename } from './folderScan';

export const RECORDINGS_BUCKET = 'call-recordings';

/**
 * Upload a local recording file to Supabase Storage.
 * Object path convention: {userId}/{deviceId}/{callId}.{ext}
 *
 * Returns the storage path on success.
 */
export async function uploadRecording(args: {
  userId: string;
  deviceId: string;
  callId: string;
  localUri: string;
  filename: string;
}): Promise<{ path: string; mime: string }> {
  const ext = (args.filename.split('.').pop() ?? 'm4a').toLowerCase();
  const path = `${args.userId}/${args.deviceId}/${args.callId}.${ext}`;
  const mime = mimeForFilename(args.filename);

  const file = new File(args.localUri);
  const bytes = await file.bytes();

  const { error } = await supabase.storage
    .from(RECORDINGS_BUCKET)
    .upload(path, bytes, {
      contentType: mime,
      upsert: true,
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
