import { PermissionsAndroid, Platform } from 'react-native';

// react-native-call-log is Android-only and ships native code; require it
// lazily so the bundle still runs in Expo Go and web preview, where the
// native module isn't linked. On other platforms we return empty results.
type CallLogModule = { load: (limit: number, filter?: object) => Promise<RawCallLogEntry[]> };
let CallLogs: CallLogModule | null = null;
if (Platform.OS === 'android') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-call-log');
    const candidate = (mod?.default ?? mod) as CallLogModule | undefined;
    if (candidate && typeof candidate.load === 'function') CallLogs = candidate;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[callLog] native module unavailable — running in Expo Go?', e);
  }
}

export type RawCallLogEntry = {
  phoneNumber?: string;
  name?: string;
  type?: string; // INCOMING | OUTGOING | MISSED | REJECTED | BLOCKED | UNKNOWN
  dateTime?: string; // human-readable
  timestamp?: string | number;
  duration?: string | number;
  rawType?: string | number;
};

export type NormalizedCallLogEntry = {
  callLogId: string; // synthesized from timestamp+number (CallLog._ID isn't exposed by the lib)
  phoneNumber: string | null;
  contactName: string | null;
  direction: 'incoming' | 'outgoing' | 'missed' | 'rejected';
  startedAtMs: number;
  durationSec: number;
};

export async function ensureCallLogPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
    {
      title: 'Call log access',
      message:
        'Calling needs to read your phone call history to sync calls and pair them with recordings.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

function normalizeDirection(
  type?: string,
): NormalizedCallLogEntry['direction'] {
  switch ((type ?? '').toUpperCase()) {
    case 'INCOMING':
      return 'incoming';
    case 'OUTGOING':
      return 'outgoing';
    case 'MISSED':
      return 'missed';
    case 'REJECTED':
      return 'rejected';
    default:
      return 'incoming';
  }
}

/**
 * Read CallLog entries newer than `sinceMs` (epoch ms). Returns newest-first.
 */
export async function readCallLog(
  sinceMs: number,
  limit = 500,
): Promise<NormalizedCallLogEntry[]> {
  if (Platform.OS !== 'android' || !CallLogs) return [];
  const ok = await ensureCallLogPermission();
  if (!ok) return [];

  let rows: RawCallLogEntry[] = [];
  try {
    // The lib's filter shape differs across versions — pass a generous limit
    // and filter client-side. `minTimestamp` is supported in 2.x.
    rows = await CallLogs.load(limit, { minTimestamp: String(sinceMs) });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[callLog] load failed (likely missing native module):', e);
    return [];
  }

  return rows
    .map((r) => {
      const ts =
        typeof r.timestamp === 'string' ? parseInt(r.timestamp, 10) : r.timestamp ?? 0;
      const dur =
        typeof r.duration === 'string' ? parseInt(r.duration, 10) : r.duration ?? 0;
      const phoneNumber = (r.phoneNumber ?? '').replace(/\s+/g, '') || null;
      return {
        callLogId: `${ts}_${phoneNumber ?? 'unknown'}`,
        phoneNumber,
        contactName: r.name?.trim() ? r.name : null,
        direction: normalizeDirection(r.type),
        startedAtMs: ts,
        durationSec: dur,
      } satisfies NormalizedCallLogEntry;
    })
    .filter((e) => e.startedAtMs > sinceMs)
    .sort((a, b) => b.startedAtMs - a.startedAtMs);
}
