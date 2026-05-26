import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { supabase } from '../supabase/client';
import { readCallLog } from '../sync/callLog';
import { ensureDeviceRow } from '../sync/device';
import { mimeForFilename } from '../sync/folderScan';
import { uploadRecording } from '../sync/uploader';

// Lazy native-module require: react-native-receive-sharing-intent has a native
// side and won't load in Expo Go / web. We no-op the listener in that case.
type ReceiveSharingIntentModule = {
  getReceivedFiles: (
    onSuccess: (files: SharedFile[]) => void,
    onError: (err: unknown) => void,
    protocol?: string,
  ) => void;
  clearReceivedFiles: () => void;
};
let ReceiveSharingIntent: ReceiveSharingIntentModule | null = null;
if (Platform.OS === 'android') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-receive-sharing-intent');
    const candidate = (mod?.default ?? mod) as
      | ReceiveSharingIntentModule
      | undefined;
    if (candidate && typeof candidate.getReceivedFiles === 'function') {
      ReceiveSharingIntent = candidate;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[share] native module unavailable — running in Expo Go?', e);
  }
}

type SharedFile = {
  filePath?: string;
  contentUri?: string;
  fileName?: string;
  mimeType?: string;
  extension?: string;
};

/**
 * Register a global listener for files shared into the app from the Google
 * Dialer (or any other audio share source). Returns an unsubscribe fn.
 */
export function registerShareIntentListener(): () => void {
  if (!ReceiveSharingIntent) return () => undefined;
  try {
    ReceiveSharingIntent.getReceivedFiles(
      async (files: SharedFile[]) => {
        for (const f of files) {
          await handleSharedFile(f).catch((e) =>
            // eslint-disable-next-line no-console
            console.warn('[share] failed', e),
          );
        }
        ReceiveSharingIntent?.clearReceivedFiles();
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.warn('[share] listener error', err);
      },
      'com.calling.app.share',
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[share] registration failed:', e);
    return () => undefined;
  }
  return () => {
    try {
      ReceiveSharingIntent?.clearReceivedFiles();
    } catch {
      // ignore
    }
  };
}

async function handleSharedFile(f: SharedFile) {
  const localUri = f.filePath
    ? f.filePath.startsWith('file://')
      ? f.filePath
      : 'file://' + f.filePath
    : f.contentUri;
  if (!localUri) return;
  const filename = f.fileName ?? localUri.split('/').pop() ?? 'shared.m4a';
  const mime = f.mimeType ?? mimeForFilename(filename);
  if (!mime.startsWith('audio')) return;

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return;
  const deviceId = await ensureDeviceRow({ userId });

  // Pair to a CallLog entry by recording mtime closest to a recent call.
  let fileMtimeMs = Date.now();
  try {
    const file = new File(localUri);
    if (file.exists && typeof file.modificationTime === 'number') {
      fileMtimeMs = file.modificationTime;
    }
  } catch {
    // fall back to now()
  }

  const recentCalls = await readCallLog(Date.now() - 24 * 3600 * 1000, 200);
  let best = null;
  let bestDelta = Infinity;
  for (const c of recentCalls) {
    const target = c.startedAtMs + c.durationSec * 1000;
    const delta = Math.abs(fileMtimeMs - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = c;
    }
  }
  if (!best) return;

  const { data: row, error: upErr } = await supabase
    .from('calls')
    .upsert(
      {
        user_id: userId,
        device_id: deviceId,
        phone_number: best.phoneNumber,
        contact_name: best.contactName,
        direction: best.direction,
        started_at: new Date(best.startedAtMs).toISOString(),
        duration_sec: best.durationSec,
        call_log_id: best.callLogId,
      },
      { onConflict: 'device_id,call_log_id' },
    )
    .select('id')
    .single();
  if (upErr) throw upErr;

  const { path } = await uploadRecording({
    userId,
    deviceId,
    callId: row.id,
    localUri,
    filename,
  });

  await supabase
    .from('calls')
    .update({
      recording_storage_path: path,
      recording_mime: mime,
      recording_source: 'manual_share',
    })
    .eq('id', row.id);
}
