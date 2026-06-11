import { Directory, File } from 'expo-file-system';
import { Platform } from 'react-native';
import { logSyncEvent } from './eventLog';

/**
 * Folders known to contain native call recordings across major Android OEMs.
 * The scanner tolerates missing folders silently — we just look at whichever
 * actually exist on the device.
 */
export const DEFAULT_RECORDING_FOLDERS = [
  // Stock Android / Pixel / Google Recorder
  'file:///storage/emulated/0/Recordings/Call/',
  'file:///storage/emulated/0/Recordings/',

  // Samsung (One UI)
  'file:///storage/emulated/0/Sounds/Voice Recorder/',
  'file:///storage/emulated/0/Recordings/Call/',
  'file:///storage/emulated/0/Call/',

  // Xiaomi / Redmi / POCO (MIUI / HyperOS) — naming varies across versions
  'file:///storage/emulated/0/MIUI/sound_recorder/call_rec/',
  'file:///storage/emulated/0/MIUI/sound_recorder/',
  'file:///storage/emulated/0/MIUI/sound recorder/call-rec/',
  'file:///storage/emulated/0/MIUI/sound recorder/call_rec/',
  'file:///storage/emulated/0/MIUI/sound recorder/',
  'file:///storage/emulated/0/MIUI/Sound recorder/Call-rec/',
  'file:///storage/emulated/0/MIUI/Sound Recorder/Call Rec/',
  'file:///storage/emulated/0/MIUI/SoundRecorder/call_rec/',
  'file:///storage/emulated/0/Recordings/Call Recordings/',

  // OnePlus / Oppo / Realme (ColorOS / OxygenOS)
  'file:///storage/emulated/0/Recordings/Call/',
  'file:///storage/emulated/0/Music/Recordings/Call Recordings/',
  'file:///storage/emulated/0/Music/Recordings/',
  'file:///storage/emulated/0/Recordings/PhoneRecord/',
  // ColorOS-specific top-level folders (older + newer naming)
  'file:///storage/emulated/0/CallRecord/',
  'file:///storage/emulated/0/Call Record/',
  'file:///storage/emulated/0/Call Recorder/',
  'file:///storage/emulated/0/.callRecord/',
  'file:///storage/emulated/0/PhoneRecord/',

  // Vivo / iQOO (FunTouch OS / OriginOS)
  'file:///storage/emulated/0/Record/Call/',
  'file:///storage/emulated/0/Music/Record/Call/',
  'file:///storage/emulated/0/记录/通话/',

  // Huawei / Honor (EMUI / MagicOS)
  'file:///storage/emulated/0/Sounds/CallRecord/',
  'file:///storage/emulated/0/Music/Recordings/',

  // Motorola
  'file:///storage/emulated/0/PhoneRecord/',
  'file:///storage/emulated/0/Recordings/Call/',

  // ASUS / Lenovo / Tecno / Infinix (generic)
  'file:///storage/emulated/0/CallRecordings/',
  'file:///storage/emulated/0/PhoneRecord/',

  // Nothing OS (uses Google Recorder layout)
  'file:///storage/emulated/0/Recordings/Call/',
];

const AUDIO_EXTS = ['.m4a', '.mp3', '.amr', '.3gp', '.wav', '.aac', '.opus', '.ogg', '.mp4'];
const IN_PROGRESS_SUFFIXES = ['.tmp', '.part', '.crdownload', '.partial', '.!ut'];
const MIN_AUDIO_BYTES = 1024;

export type RecordingFile = {
  uri: string;
  filename: string;
  mtimeMs: number;
  sizeBytes: number;
};

function isAudioFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (IN_PROGRESS_SUFFIXES.some((s) => lower.endsWith(s))) return false;
  if (lower.startsWith('.')) return false;
  return AUDIO_EXTS.some((ext) => lower.endsWith(ext));
}

function extForName(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot) : '';
}

/**
 * Walk the given folders one level deep and return audio files modified after
 * `sinceMs`. Tiny files (likely still being written) are skipped so the next
 * pass picks them up cleanly.
 */
export async function scanRecordingFolders(
  folders: string[] = DEFAULT_RECORDING_FOLDERS,
  sinceMs = 0,
): Promise<RecordingFile[]> {
  if (Platform.OS !== 'android') return [];
  const results: RecordingFile[] = [];
  const seen = new Set<string>();

  // De-dupe paths because several OEMs share the same fallback dir.
  const uniqueFolders = Array.from(new Set(folders));
  logSyncEvent({
    kind: 'scan_started',
    ts: Date.now(),
    folderCount: uniqueFolders.length,
    sinceMs,
  });

  for (const folderUri of uniqueFolders) {
    let dir: Directory;
    try {
      dir = new Directory(folderUri);
      if (!dir.exists) {
        logSyncEvent({
          kind: 'scan_folder_inaccessible',
          ts: Date.now(),
          folderUri,
          reason: 'missing',
        });
        continue;
      }
    } catch {
      logSyncEvent({
        kind: 'scan_folder_inaccessible',
        ts: Date.now(),
        folderUri,
        reason: 'open_failed',
      });
      continue;
    }

    let entries: (File | Directory)[] = [];
    try {
      entries = dir.list();
    } catch {
      logSyncEvent({
        kind: 'scan_folder_inaccessible',
        ts: Date.now(),
        folderUri,
        reason: 'list_failed',
      });
      continue;
    }

    for (const entry of entries) {
      if (!(entry instanceof File)) continue;
      const name = entry.name ?? '';
      if (!isAudioFile(name)) continue;
      const mtimeMs = entry.modificationTime ?? 0;
      if (mtimeMs <= sinceMs) continue;
      const sizeBytes = entry.size ?? 0;
      if (sizeBytes < MIN_AUDIO_BYTES) continue;
      if (seen.has(entry.uri)) continue;
      seen.add(entry.uri);
      logSyncEvent({
        kind: 'recording_found',
        ts: Date.now(),
        folderUri,
        ext: extForName(name),
        sizeBytes,
        mtimeMs,
      });
      results.push({
        uri: entry.uri,
        filename: name,
        mtimeMs,
        sizeBytes,
      });
    }
  }

  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results;
}

export function mimeForFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.m4a') || lower.endsWith('.aac') || lower.endsWith('.mp4'))
    return 'audio/mp4';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.amr')) return 'audio/amr';
  if (lower.endsWith('.3gp')) return 'audio/3gpp';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.opus') || lower.endsWith('.ogg')) return 'audio/ogg';
  return 'application/octet-stream';
}
