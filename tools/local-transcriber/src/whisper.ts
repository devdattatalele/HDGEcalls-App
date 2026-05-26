import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileP = promisify(execFile);

const WHISPER_CLI =
  process.env.WHISPER_CLI ?? '/opt/homebrew/bin/whisper-cli';
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ?? './models/ggml-small.bin';
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE ?? 'auto';
const EXTRA_ARGS = (process.env.WHISPER_EXTRA_ARGS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export type Segment = {
  start: number;
  end: number;
  text: string;
};

export type WhisperResult = {
  text: string;
  segments: Segment[];
};

/**
 * Run whisper-cli on a 16kHz WAV file. Uses JSON output for segments and
 * concatenates segment text for the full transcript.
 */
export async function transcribeFile(wavPath: string): Promise<WhisperResult> {
  const outPrefix = path.join(path.dirname(wavPath), 'out');
  const args = [
    '-m', WHISPER_MODEL,
    '-f', wavPath,
    '-l', WHISPER_LANGUAGE,
    '-oj',                  // JSON output
    '-of', outPrefix,
    '--no-prints',
    ...EXTRA_ARGS,
  ];

  // whisper-cli writes to outPrefix + '.json'. stdout has progress logs.
  await execFileP(WHISPER_CLI, args, { maxBuffer: 32 * 1024 * 1024 });

  const jsonPath = outPrefix + '.json';
  const raw = await fs.readFile(jsonPath, 'utf8');
  const parsed = JSON.parse(raw) as WhisperJson;

  const segments: Segment[] = (parsed.transcription ?? []).map((s) => ({
    start: parseTimestamp(s.offsets?.from ?? 0),
    end: parseTimestamp(s.offsets?.to ?? 0),
    text: (s.text ?? '').trim(),
  }));
  const text = segments.map((s) => s.text).join(' ').trim();
  return { text, segments };
}

// whisper.cpp JSON offsets are in milliseconds; convert to seconds.
function parseTimestamp(ms: number): number {
  return Math.round(ms) / 1000;
}

type WhisperJson = {
  transcription?: Array<{
    text?: string;
    offsets?: { from: number; to: number };
  }>;
};
