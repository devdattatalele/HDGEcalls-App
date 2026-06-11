import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { fetchUsage } from '../data/profile';
import { supabase } from '../supabase/client';
import {
  isAppInitiated,
  loadActiveAppDials,
  markDialMatched,
  pruneOldAppDials,
} from './appDials';
import { readCallLog, type NormalizedCallLogEntry } from './callLog';
import { ensureDeviceRow, updateDeviceLastSynced } from './device';
import { last4Digits, logSyncEvent } from './eventLog';
import { scanRecordingFolders, type RecordingFile } from './folderScan';
import { pairCallsToRecordings } from './pairing';
import { uploadRecording } from './uploader';

export const BACKGROUND_SYNC_TASK = 'hdgecalls.background.sync';
const SYNC_CURSOR_KEY = 'hdgecalls.sync.cursorMs';
const LIMIT_NOTIFIED_KEY_PREFIX = 'hdgecalls.sync.limitNotified.';

export type SyncResult = {
  inserted: number;
  errors: number;
  skipped?: number;
};

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function notifySyncedCall(opts: {
  callId: string;
  contactName: string | null;
  phoneNumber: string | null;
  durationSec: number;
  direction: string;
}) {
  const who = opts.contactName || opts.phoneNumber || 'Unknown';
  const mins = Math.floor(opts.durationSec / 60);
  const secs = opts.durationSec % 60;
  const dur = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  const arrow = opts.direction === 'incoming' ? '↙' : '↗';
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Call synced',
        body: `${arrow} ${who} · ${dur} · tap to open`,
        data: { route: `/call/${opts.callId}` },
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: null,
    });
  } catch {
    // notification permission may not be granted — never block sync
  }
}

async function maybeNotifyLimit(limit: number) {
  const key = LIMIT_NOTIFIED_KEY_PREFIX + currentMonthKey();
  const seen = await AsyncStorage.getItem(key);
  if (seen) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'HDGEcalls limit reached',
        body: `You've used your ${limit} recordings for this month. New calls will sync next month, or upgrade to keep going.`,
        data: { route: '/plan' },
      },
      trigger: null,
    });
  } catch {
    // notifications permission not granted — silently skip
  }
  await AsyncStorage.setItem(key, '1');
}

async function settled<T>(p: Promise<T>, label: string, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[sync] ${label} failed:`, e);
    return fallback;
  }
}

async function ensureFreshSession(): Promise<
  Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'] | null
> {
  const { data } = await supabase.auth.getSession();
  let session = data.session;
  if (!session) return null;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = session.expires_at ?? 0;
  if (expiresAt - now < 60) {
    try {
      const refreshed = await supabase.auth.refreshSession();
      session = refreshed.data.session ?? session;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[sync] refreshSession failed, aborting pass:', e);
      return null;
    }
  }
  return session;
}

// Module-scope re-entrancy guard — protects both foreground and background
// triggers. Overlapping callers share one in-flight pass.
let inFlight: Promise<SyncResult> | null = null;

/**
 * Run one sync pass. Only CallLog entries that were initiated from inside this
 * app (recorded via `recordAppDial`) AND have a paired on-disk recording are
 * uploaded. Anything else stays local.
 *
 * If the user is over their monthly recording cap (profile_usage view), we
 * skip uploads entirely and fire a one-time notification this month.
 */
export function runSyncOnce(): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = (async (): Promise<SyncResult> => {
    if (Platform.OS !== 'android') {
      logSyncEvent({ kind: 'sync_skipped', ts: Date.now(), reason: 'not_android' });
      return { inserted: 0, errors: 0 };
    }

    const session = await ensureFreshSession();
    if (!session) {
      logSyncEvent({ kind: 'sync_skipped', ts: Date.now(), reason: 'no_session' });
      return { inserted: 0, errors: 0 };
    }
    const userId = session.user.id;

    // Soft cap based on plan limits.
    let usage = null;
    try {
      usage = await fetchUsage(userId);
    } catch {
      // If the view doesn't exist yet (e.g. migration not applied), fall through.
    }
    if (
      usage &&
      usage.recordings_used_this_month >= usage.monthly_recording_limit
    ) {
      logSyncEvent({ kind: 'sync_skipped', ts: Date.now(), reason: 'limit_reached' });
      await maybeNotifyLimit(usage.monthly_recording_limit);
      return { inserted: 0, errors: 0, skipped: -1 };
    }
    const remaining = usage
      ? Math.max(0, usage.monthly_recording_limit - usage.recordings_used_this_month)
      : Infinity;

    const deviceId = await ensureDeviceRow({ userId });

    const cursorRaw = await AsyncStorage.getItem(SYNC_CURSOR_KEY);
    // First run looks back 7 days. After that we use the saved cursor BUT
    // always also rescan the last 30 minutes so OEMs that finalise the audio
    // file a couple of minutes after the call ends still get picked up on the
    // following sync pass. Idempotency on (device_id, call_log_id) dedupes.
    const RETRY_WINDOW_MS = 30 * 60 * 1000;
    const savedCursor = cursorRaw ? parseInt(cursorRaw, 10) : Date.now() - 7 * 24 * 3600 * 1000;
    const cursorMs = Math.min(savedCursor, Date.now() - RETRY_WINDOW_MS);
    logSyncEvent({ kind: 'sync_started', ts: Date.now(), cursorMs });

    // allSettled: a revoked call-log permission or a folder-scan glitch
    // shouldn't abort the whole pass.
    const [calls, recordings] = await Promise.all([
      settled<NormalizedCallLogEntry[]>(readCallLog(cursorMs), 'readCallLog', []),
      settled<RecordingFile[]>(
        scanRecordingFolders(undefined, cursorMs - 5 * 60_000),
        'scanRecordingFolders',
        [],
      ),
    ]);

    const pairings = pairCallsToRecordings(calls, recordings);

    // Only sync calls the user dialed from inside the app (or incoming
    // callbacks from a number dialed in the last 24h).
    const appDials = await loadActiveAppDials();
    const allowedPairings = pairings
      .filter((p) => p.recording)
      .map((p) => {
        const dial = isAppInitiated(p.call, appDials);
        if (!dial) {
          logSyncEvent({
            kind: 'pairing_rejected_not_app_dialed',
            ts: Date.now(),
            direction: p.call.direction,
            numberSuffix: last4Digits(p.call.phoneNumber),
          });
        }
        return { p, dial };
      })
      .filter((x): x is { p: typeof x.p; dial: NonNullable<typeof x.dial> } => x.dial !== null);

    let inserted = 0;
    let errors = 0;
    let budget = remaining;

    for (const { p, dial } of allowedPairings) {
      if (!p.recording) continue;
      if (budget <= 0) {
        if (usage) await maybeNotifyLimit(usage.monthly_recording_limit);
        break;
      }

      try {
        // Idempotency: skip if this CallLog entry was already synced.
        const { data: existing } = await supabase
          .from('calls')
          .select('id')
          .eq('device_id', deviceId)
          .eq('call_log_id', p.call.callLogId)
          .maybeSingle();
        if (existing) {
          await markDialMatched(dial.dialedAtMs, p.call.callLogId);
          continue;
        }

        const callId = Crypto.randomUUID();

        logSyncEvent({
          kind: 'upload_started',
          ts: Date.now(),
          direction: p.call.direction,
          numberSuffix: last4Digits(p.call.phoneNumber),
        });
        const { path, mime } = await uploadRecording({
          userId,
          callId,
          phoneNumber: p.call.phoneNumber,
          startedAtMs: p.call.startedAtMs,
          localUri: p.recording.uri,
          filename: p.recording.filename,
        });

        const { error: insErr } = await supabase.from('calls').insert({
          id: callId,
          user_id: userId,
          device_id: deviceId,
          phone_number: p.call.phoneNumber,
          contact_name: p.call.contactName,
          direction: p.call.direction,
          started_at: new Date(p.call.startedAtMs).toISOString(),
          duration_sec: p.call.durationSec,
          call_log_id: p.call.callLogId,
          recording_storage_path: path,
          recording_mime: mime,
          recording_source: 'auto',
        });
        if (insErr) throw insErr;

        await markDialMatched(dial.dialedAtMs, p.call.callLogId);
        await notifySyncedCall({
          callId,
          contactName: p.call.contactName,
          phoneNumber: p.call.phoneNumber,
          durationSec: p.call.durationSec,
          direction: p.call.direction,
        });
        logSyncEvent({
          kind: 'upload_success',
          ts: Date.now(),
          direction: p.call.direction,
          numberSuffix: last4Digits(p.call.phoneNumber),
          durationSec: p.call.durationSec,
        });
        inserted++;
        budget--;
      } catch (e) {
        errors++;
        logSyncEvent({
          kind: 'upload_failed',
          ts: Date.now(),
          direction: p.call.direction,
          numberSuffix: last4Digits(p.call.phoneNumber),
          errorName: e instanceof Error ? e.name : 'Error',
        });
        // eslint-disable-next-line no-console
        console.warn('[sync] failed for call', p.call.callLogId, e);
      }
    }

    // Advance cursor to the newest CallLog entry we saw (paired or not), so the
    // next pass doesn't keep re-reading older unmatched entries.
    const newest = calls[0]?.startedAtMs;
    if (newest && newest > cursorMs) {
      await AsyncStorage.setItem(SYNC_CURSOR_KEY, String(newest));
    }
    await updateDeviceLastSynced(deviceId);
    await pruneOldAppDials();
    logSyncEvent({ kind: 'sync_finished', ts: Date.now(), inserted, errors });

    return { inserted, errors };
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
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
