import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { supabase } from '../supabase/client';
import { readCallLog } from './callLog';
import { ensureDeviceRow, updateDeviceLastSynced } from './device';
import { scanRecordingFolders } from './folderScan';
import { pairCallsToRecordings } from './pairing';
import { uploadRecording } from './uploader';

export const BACKGROUND_SYNC_TASK = 'calling.background.sync';
const SYNC_CURSOR_KEY = 'calling.sync.cursorMs';

/**
 * Run one sync pass: read new CallLog entries, pair with recordings, upload,
 * upsert `calls` rows. Designed to be idempotent — safe to call repeatedly.
 */
export async function runSyncOnce(): Promise<{
  inserted: number;
  paired: number;
  errors: number;
}> {
  if (Platform.OS !== 'android') return { inserted: 0, paired: 0, errors: 0 };

  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return { inserted: 0, paired: 0, errors: 0 };
  const userId = session.user.id;

  const deviceId = await ensureDeviceRow({ userId });

  const cursorRaw = await AsyncStorage.getItem(SYNC_CURSOR_KEY);
  // Default: look back 7 days on first run.
  const cursorMs = cursorRaw
    ? parseInt(cursorRaw, 10)
    : Date.now() - 7 * 24 * 3600 * 1000;

  const [calls, recordings] = await Promise.all([
    readCallLog(cursorMs),
    scanRecordingFolders(undefined, cursorMs - 60_000),
  ]);

  const pairings = pairCallsToRecordings(calls, recordings);

  let inserted = 0;
  let paired = 0;
  let errors = 0;

  for (const p of pairings) {
    try {
      // Upsert call row first (so we have an id to namespace the storage path).
      const { data: row, error: upErr } = await supabase
        .from('calls')
        .upsert(
          {
            user_id: userId,
            device_id: deviceId,
            phone_number: p.call.phoneNumber,
            contact_name: p.call.contactName,
            direction: p.call.direction,
            started_at: new Date(p.call.startedAtMs).toISOString(),
            duration_sec: p.call.durationSec,
            call_log_id: p.call.callLogId,
          },
          { onConflict: 'device_id,call_log_id' },
        )
        .select('id, recording_storage_path')
        .single();
      if (upErr) throw upErr;
      inserted++;

      // Upload recording if we have one and haven't already.
      if (p.recording && !row.recording_storage_path) {
        const { path, mime } = await uploadRecording({
          userId,
          deviceId,
          callId: row.id,
          localUri: p.recording.uri,
          filename: p.recording.filename,
        });
        const { error: patchErr } = await supabase
          .from('calls')
          .update({
            recording_storage_path: path,
            recording_mime: mime,
            recording_source: 'auto',
          })
          .eq('id', row.id);
        if (patchErr) throw patchErr;
        paired++;
      }
    } catch (e) {
      errors++;
      // eslint-disable-next-line no-console
      console.warn('[sync] failed for call', p.call.callLogId, e);
    }
  }

  // Advance cursor to the newest call we processed.
  const newest = calls[0]?.startedAtMs;
  if (newest && newest > cursorMs) {
    await AsyncStorage.setItem(SYNC_CURSOR_KEY, String(newest));
  }
  await updateDeviceLastSynced(deviceId);

  return { inserted, paired, errors };
}

// ---------------------------------------------------------------------------
// Background registration
// ---------------------------------------------------------------------------

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    const result = await runSyncOnce();
    return result.errors > 0
      ? BackgroundFetch.BackgroundFetchResult.Failed
      : BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[bg-sync] task error', e);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundSync(intervalSec = 15 * 60) {
  if (Platform.OS !== 'android') return;
  const status = await BackgroundFetch.getStatusAsync();
  if (status === BackgroundFetch.BackgroundFetchStatus.Restricted) return;
  await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
    minimumInterval: intervalSec,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

export async function unregisterBackgroundSync() {
  const registered = await TaskManager.isTaskRegisteredAsync(
    BACKGROUND_SYNC_TASK,
  );
  if (registered) await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
}
