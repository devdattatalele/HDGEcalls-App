import { Directory, File } from 'expo-file-system';
import { Platform } from 'react-native';

/** Default OEM call-recording folders on Android. */
export const DEFAULT_RECORDING_FOLDERS = [
  // Stock Android / Pixel / OnePlus / Realme / Oppo
  'file:///storage/emulated/0/Recordings/Call/',
  // Samsung
  'file:///storage/emulated/0/Sounds/Voice Recorder/',
  'file:///storage/emulated/0/Recordings/Call/',
  // Xiaomi / MIUI
  'file:///storage/emulated/0/MIUI/sound_recorder/call_rec/',
  // Vivo
  'file:///storage/emulated/0/Record/Call/',
];

const AUDIO_EXTS = ['.m4a', '.mp3', '.amr', '.3gp', '.wav', '.aac', '.opus', '.ogg'];

export type RecordingFile = {
  uri: string;
  filename: string;
  mtimeMs: number; // file last-modified, used to pair with a call
  sizeBytes: number;
};

function isAudioFile(name: string): boolean {
  const lower = name.toLowerCase();
  return AUDIO_EXTS.some((ext) => lower.endsWith(ext));
}

/**
 * List audio files inside the given folders. Returns files modified after `sinceMs`.
 */
export async function scanRecordingFolders(
  folders: string[] = DEFAULT_RECORDING_FOLDERS,
  sinceMs = 0,
): Promise<RecordingFile[]> {
  if (Platform.OS !== 'android') return [];
  const results: RecordingFile[] = [];

  for (const folderUri of folders) {
    let dir: Directory;
    try {
      dir = new Directory(folderUri);
      if (!dir.exists) continue;
    } catch {
      continue;
    }

    let entries: (File | Directory)[] = [];
    try {
      entries = dir.list();
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!(entry instanceof File)) continue;
      const name = entry.name ?? '';
      if (!isAudioFile(name)) continue;
      const mtimeMs = entry.modificationTime ?? 0;
      if (mtimeMs <= sinceMs) continue;
      results.push({
        uri: entry.uri,
        filename: name,
        mtimeMs,
        sizeBytes: entry.size ?? 0,
      });
    }
  }

  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results;
}

export function mimeForFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.m4a') || lower.endsWith('.aac')) return 'audio/mp4';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.amr')) return 'audio/amr';
  if (lower.endsWith('.3gp')) return 'audio/3gpp';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.opus') || lower.endsWith('.ogg')) return 'audio/ogg';
  return 'application/octet-stream';
}
