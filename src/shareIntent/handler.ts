import { Audio } from 'expo-av';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import type { ShareIntentFile } from 'expo-share-intent';
import { supabase } from '../supabase/client';
import { readCallLog } from '../sync/callLog';
import { ensureDeviceRow } from '../sync/device';
import { mimeForFilename } from '../sync/folderScan';
import { uploadRecording } from '../sync/uploader';

// OEM call recorders typically embed the phone number in the filename, e.g.
// "Call recording 9876543210_20260605_1234.m4a" or "+919876543210_..."
function extractPhoneFromFilename(name: string): string | null {
  const digits = name.replace(/[^\d+]/g, '');
  const m = digits.match(/\+?\d{10,13}/);
  return m ? m[0] : null;
}

async function probeAudioDurationSec(uri: string): Promise<number> {
  let sound: Audio.Sound | null = null;
  try {
    const res = await Audio.Sound.createAsync({ uri }, { shouldPlay: false });
    sound = res.sound;
    const status = res.status;
    if (status.isLoaded && status.durationMillis) {
      return Math.round(status.durationMillis / 1000);
    }
    return 0;
  } catch {
    return 0;
  } finally {
    if (sound) await sound.unloadAsync().catch(() => undefined);
  }
}

export interface ShareResult {
  ok: boolean;
  reason?: string;
  callId?: string;
}

/**
 * Process one file shared into the app from the system share sheet. Only
 * audio shares are accepted — everything else is dropped silently so the app
 * can stay in the share sheet for ALL mime types without polluting the calls
 * table.
 */
export async function handleSharedFile(
  f: ShareIntentFile,
): Promise<ShareResult> {
  const path = f.path ?? '';
  const filename =
    f.fileName?.trim() || path.split('/').pop() || 'shared.m4a';
  const mime = f.mimeType?.trim() || mimeForFilename(filename);

  if (!mime.startsWith('audio')) {
    return { ok: false, reason: `ignored non-audio share (${mime})` };
  }
  const localUri = path
    ? path.startsWith('file://') || path.startsWith('content://')
      ? path
      : 'file://' + path
    : null;
  if (!localUri) return { ok: false, reason: 'no path' };

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return { ok: false, reason: 'not signed in' };
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

  // Soft match: try to lift phone number / contact / direction from a recent
  // call log entry whose end time is closest to the file's mtime. This is
  // best-effort — if we can't find a match we still upload (the user
  // explicitly shared a file; we don't want to silently swallow it).
  const recentCalls = await readCallLog(Date.now() - 24 * 3600 * 1000, 200);
  const MATCH_WINDOW_MS = 10 * 60 * 1000;
  let best: (typeof recentCalls)[number] | null = null;
  let bestDelta = Infinity;
  for (const c of recentCalls) {
    const target = c.startedAtMs + c.durationSec * 1000;
    const delta = Math.abs(fileMtimeMs - target);
    if (delta < bestDelta && delta <= MATCH_WINDOW_MS) {
      bestDelta = delta;
      best = c;
    }
  }

  const callId = Crypto.randomUUID();
  // Prefer call-log values, but always fall back to data we can derive from
  // the shared file itself so we never insert a row with 0s duration or a
  // bogus epoch timestamp.
  const startedAtMs = best?.startedAtMs ?? fileMtimeMs;
  const phoneNumber =
    best?.phoneNumber ?? extractPhoneFromFilename(filename);
  // Probe the audio for real duration when call log didn't give us one.
  const probedDurationSec = best?.durationSec ?? (await probeAudioDurationSec(localUri));

  const { path: uploadedPath, mime: uploadedMime } = await uploadRecording({
    userId,
    callId,
    phoneNumber,
    startedAtMs,
    localUri,
    filename,
  });

  // Insert with call_log_id = null so the (device_id, call_log_id) unique
  // constraint never collides with an auto-synced row. Multiple manual
  // shares can coexist; the user explicitly asked for each one.
  const { error: insErr } = await supabase.from('calls').insert({
    id: callId,
    user_id: userId,
    device_id: deviceId,
    phone_number: phoneNumber,
    contact_name: best?.contactName ?? null,
    direction: best?.direction ?? null,
    started_at: new Date(startedAtMs).toISOString(),
    duration_sec: probedDurationSec,
    call_log_id: null,
    recording_storage_path: uploadedPath,
    recording_mime: uploadedMime ?? mime,
    recording_source: 'manual_share',
  });
  if (insErr) throw insErr;
  return { ok: true, callId };
}
