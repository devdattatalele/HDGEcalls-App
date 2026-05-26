import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileP = promisify(execFile);
const FFMPEG = process.env.FFMPEG ?? '/opt/homebrew/bin/ffmpeg';

export async function downloadToTmp(
  url: string,
  workDir: string,
  filename: string,
): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const out = path.join(workDir, filename);
  await fs.writeFile(out, buf);
  return out;
}

/**
 * whisper.cpp requires 16-bit signed PCM WAV at 16 kHz mono. Convert whatever
 * the phone produced (.m4a / .amr / .3gp / .opus / etc.) into that.
 */
export async function convertToWav16k(
  inputPath: string,
  workDir: string,
): Promise<string> {
  const out = path.join(workDir, 'audio_16k.wav');
  await execFileP(FFMPEG, [
    '-y',
    '-i',
    inputPath,
    '-ar',
    '16000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    out,
  ]);
  return out;
}

export async function cleanupDir(dir: string) {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}
