import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'hdge:syncEventLog';
const MAX_EVENTS = 50;

type Count = ReturnType<typeof Date.now>;
type UnixMs = ReturnType<typeof Date.now>;

type BaseEvent = {
  ts: UnixMs;
};

export type SyncEvent =
  | (BaseEvent & { kind: 'app_dial_recorded'; numberSuffix: string })
  | (BaseEvent & { kind: 'app_dial_matched'; numberSuffix: string })
  | (BaseEvent & { kind: 'scan_started'; folderCount: Count; sinceMs: UnixMs })
  | (BaseEvent & {
      kind: 'scan_folder_inaccessible';
      folderUri: string;
      reason: 'missing' | 'open_failed' | 'list_failed';
    })
  | (BaseEvent & {
      kind: 'recording_found';
      folderUri: string;
      ext: string;
      sizeBytes: Count;
      mtimeMs: UnixMs;
    })
  | (BaseEvent & {
      kind: 'call_log_scanned';
      count: Count;
      newestTs: UnixMs | null;
    })
  | (BaseEvent & {
      kind: 'pairing_matched';
      reason: 'filename' | 'timestamp';
      direction: string;
      numberSuffix: string;
    })
  | (BaseEvent & {
      kind: 'pairing_rejected_not_app_dialed';
      direction: string;
      numberSuffix: string;
    })
  | (BaseEvent & {
      kind: 'pairing_no_recording_found';
      direction: string;
      numberSuffix: string;
    })
  | (BaseEvent & {
      kind: 'upload_started';
      direction: string;
      numberSuffix: string;
    })
  | (BaseEvent & {
      kind: 'upload_success';
      direction: string;
      numberSuffix: string;
      durationSec: Count;
    })
  | (BaseEvent & {
      kind: 'upload_failed';
      direction: string;
      numberSuffix: string;
      errorName: string;
    })
  | (BaseEvent & {
      kind: 'permission_denied';
      permission: 'call_log' | 'all_files' | 'notifications' | 'storage';
    })
  | (BaseEvent & { kind: 'sync_started'; cursorMs: UnixMs })
  | (BaseEvent & {
      kind: 'sync_skipped';
      reason: 'not_android' | 'no_session' | 'limit_reached';
    })
  | (BaseEvent & { kind: 'sync_finished'; inserted: Count; errors: Count });

let pendingWrite: Promise<void> = Promise.resolve();

async function readStored(): Promise<SyncEvent[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (x): x is SyncEvent =>
      x && typeof x.kind === 'string' && Number.isFinite(x.ts),
  );
}

export function last4Digits(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.slice(-4);
}

export function logSyncEvent(event: SyncEvent): void {
  pendingWrite = pendingWrite
    .then(async () => {
      try {
        const existing = await readStored();
        const next = [event, ...existing]
          .sort((a, b) => b.ts - a.ts)
          .slice(0, MAX_EVENTS);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Diagnostics must never affect sync.
      }
    })
    .catch(() => undefined);
}

export async function getSyncEventLog(): Promise<SyncEvent[]> {
  try {
    return (await readStored()).sort((a, b) => b.ts - a.ts).slice(0, MAX_EVENTS);
  } catch {
    return [];
  }
}

export async function clearSyncEventLog(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort
  }
}
