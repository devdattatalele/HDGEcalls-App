import type { NormalizedCallLogEntry } from './callLog';
import type { RecordingFile } from './folderScan';

export type Pairing = {
  call: NormalizedCallLogEntry;
  recording: RecordingFile | null;
  reason: 'filename' | 'timestamp' | 'unmatched';
};

const TAIL_TOLERANCE_MS = 60_000; // recordings often finalize a bit after the call ends

function digitsOnly(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

/**
 * Pair recordings to calls.
 *
 * Rule 1 (filename match): if the filename contains the (digits-only) phone number,
 *   and the file mtime falls within the call window (with tail tolerance), it wins.
 * Rule 2 (timestamp match): of remaining recordings, pick the one whose mtime is
 *   closest to (call.startedAt + call.duration) and within window.
 * Otherwise the call is `unmatched` for this run (may be paired on a later sync).
 */
export function pairCallsToRecordings(
  calls: NormalizedCallLogEntry[],
  recordings: RecordingFile[],
): Pairing[] {
  const usedRecordingUris = new Set<string>();
  const pairings: Pairing[] = [];

  for (const call of calls) {
    const windowStart = call.startedAtMs;
    const windowEnd =
      call.startedAtMs + call.durationSec * 1000 + TAIL_TOLERANCE_MS;
    const phoneDigits = digitsOnly(call.phoneNumber);

    let chosen: { rec: RecordingFile; reason: Pairing['reason'] } | null = null;

    // Rule 1: filename match
    if (phoneDigits.length >= 6) {
      for (const rec of recordings) {
        if (usedRecordingUris.has(rec.uri)) continue;
        const fname = digitsOnly(rec.filename);
        if (
          fname.includes(phoneDigits) &&
          rec.mtimeMs >= windowStart - TAIL_TOLERANCE_MS &&
          rec.mtimeMs <= windowEnd + TAIL_TOLERANCE_MS
        ) {
          chosen = { rec, reason: 'filename' };
          break;
        }
      }
    }

    // Rule 2: timestamp match
    if (!chosen) {
      const target = call.startedAtMs + call.durationSec * 1000;
      let best: RecordingFile | null = null;
      let bestDelta = Infinity;
      for (const rec of recordings) {
        if (usedRecordingUris.has(rec.uri)) continue;
        if (rec.mtimeMs < windowStart - TAIL_TOLERANCE_MS) continue;
        if (rec.mtimeMs > windowEnd + TAIL_TOLERANCE_MS) continue;
        const delta = Math.abs(rec.mtimeMs - target);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = rec;
        }
      }
      if (best) chosen = { rec: best, reason: 'timestamp' };
    }

    if (chosen) {
      usedRecordingUris.add(chosen.rec.uri);
      pairings.push({ call, recording: chosen.rec, reason: chosen.reason });
    } else {
      pairings.push({ call, recording: null, reason: 'unmatched' });
    }
  }

  return pairings;
}
