import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NormalizedCallLogEntry } from './callLog';
import { last4Digits, logSyncEvent } from './eventLog';

const STORAGE_KEY = 'hdgecalls.appDials.v1';
export const APP_DIAL_RETENTION_MS = 24 * 60 * 60 * 1000;
const OUTGOING_MATCH_WINDOW_MS = 60_000;

export type AppDial = {
  phoneDigits: string;
  dialedAtMs: number;
  matchedCallLogId?: string;
};

function digitsOnly(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

const PHONE_SUFFIX_LEN = 8;
const MIN_PHONE_DIGITS = 6;

/**
 * Compare two phone numbers tolerantly: matches by the last 8 digits so that
 * "9876543210" (typed in the in-app dialer) matches "+919876543210" (carrier
 * format for the incoming callback). Both sides must have at least 6 digits.
 */
export function sameNumber(a: string, b: string): boolean {
  const left = digitsOnly(a);
  const right = digitsOnly(b);
  if (left.length < MIN_PHONE_DIGITS || right.length < MIN_PHONE_DIGITS) return false;
  const n = Math.min(PHONE_SUFFIX_LEN, left.length, right.length);
  return left.slice(-n) === right.slice(-n);
}

async function read(): Promise<AppDial[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is AppDial =>
        x &&
        typeof x.phoneDigits === 'string' &&
        typeof x.dialedAtMs === 'number',
    );
  } catch {
    return [];
  }
}

async function write(dials: AppDial[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(dials));
  } catch {
    // best-effort
  }
}

function withinRetention(d: AppDial, now: number): boolean {
  return now - d.dialedAtMs <= APP_DIAL_RETENTION_MS;
}

type Listener = (dial: AppDial) => void;
const listeners = new Set<Listener>();

export function onAppDial(handler: Listener): () => void {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}

export async function recordAppDial(rawNumber: string): Promise<void> {
  const phoneDigits = digitsOnly(rawNumber);
  if (!phoneDigits) return;
  const dial: AppDial = { phoneDigits, dialedAtMs: Date.now() };
  const now = Date.now();
  const existing = (await read()).filter((d) => withinRetention(d, now));
  existing.push(dial);
  await write(existing);
  logSyncEvent({
    kind: 'app_dial_recorded',
    ts: Date.now(),
    numberSuffix: last4Digits(phoneDigits),
  });
  for (const fn of listeners) {
    try {
      fn(dial);
    } catch {
      // swallow listener errors
    }
  }
}

export async function loadActiveAppDials(): Promise<AppDial[]> {
  const now = Date.now();
  return (await read()).filter((d) => withinRetention(d, now));
}

export async function markDialMatched(
  dialedAtMs: number,
  callLogId: string,
): Promise<void> {
  const dials = await read();
  const updated = dials.map((d) =>
    d.dialedAtMs === dialedAtMs && !d.matchedCallLogId
      ? { ...d, matchedCallLogId: callLogId }
      : d,
  );
  await write(updated);
  const matched = dials.find((d) => d.dialedAtMs === dialedAtMs);
  if (matched) {
    logSyncEvent({
      kind: 'app_dial_matched',
      ts: Date.now(),
      numberSuffix: last4Digits(matched.phoneDigits),
    });
  }
}

export async function pruneOldAppDials(): Promise<void> {
  const now = Date.now();
  const dials = await read();
  const kept = dials.filter((d) => withinRetention(d, now));
  if (kept.length !== dials.length) await write(kept);
}

/**
 * Returns the AppDial that "claims" this call-log entry, or null.
 *
 * - Outgoing: same number, dialed within ±60s of call start.
 * - Incoming: same number, dialed in the last 24h *before* the call.
 * - Missed/rejected: never claimed (no recording anyway).
 *
 * The earliest unmatched dial wins so repeated dials of the same number
 * don't all claim the same recording.
 */
export function isAppInitiated(
  call: NormalizedCallLogEntry,
  appDials: AppDial[],
): AppDial | null {
  const callDigits = digitsOnly(call.phoneNumber);
  if (!callDigits) return null;
  if (call.direction !== 'outgoing' && call.direction !== 'incoming') {
    return null;
  }

  const candidates = appDials
    .filter((d) => sameNumber(d.phoneDigits, callDigits))
    .filter((d) => !d.matchedCallLogId)
    .sort((a, b) => a.dialedAtMs - b.dialedAtMs);

  for (const d of candidates) {
    if (call.direction === 'outgoing') {
      if (Math.abs(call.startedAtMs - d.dialedAtMs) <= OUTGOING_MATCH_WINDOW_MS) {
        return d;
      }
    } else {
      const delta = call.startedAtMs - d.dialedAtMs;
      if (delta > 0 && delta <= APP_DIAL_RETENTION_MS) return d;
    }
  }
  return null;
}
