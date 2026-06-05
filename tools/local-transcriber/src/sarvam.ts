import fs from 'node:fs/promises';
import path from 'node:path';
import type { Segment, WhisperResult } from './whisper.ts';

/**
 * Sarvam Saarika transcription backend.
 *
 * Why Sarvam: purpose-built ASR for Indian languages (Hindi, Marathi,
 * Bengali, Tamil, …) with native code-switching and speaker diarization.
 * The customer's own vendor sheet ranks this as the best-quality option for
 * Hinglish/Marathi B2B call audio. ~$0.006-0.008/min.
 *
 * Docs: https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe
 */

const SARVAM_API_BASE =
  process.env.SARVAM_API_BASE ?? 'https://api.sarvam.ai';
const SARVAM_MODEL = process.env.SARVAM_MODEL ?? 'saarika:v2.5';
// 'unknown' tells Sarvam to auto-detect per request (handles Marathi-dominant
// vs Hindi-dominant calls without per-call configuration). Force a specific
// code (mr-IN / hi-IN / en-IN) only if the customer has a uniform stream.
const SARVAM_LANGUAGE = process.env.SARVAM_LANGUAGE ?? 'unknown';
const SARVAM_WITH_DIARIZATION =
  (process.env.SARVAM_WITH_DIARIZATION ?? '1') !== '0';
const SARVAM_NUM_SPEAKERS = process.env.SARVAM_NUM_SPEAKERS;

export function sarvamProviderLabel(): string {
  return `sarvam:${SARVAM_MODEL}`;
}

export async function transcribeFileSarvam(
  audioPath: string,
): Promise<WhisperResult> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    throw new Error(
      'SARVAM_API_KEY not set — get one from https://dashboard.sarvam.ai',
    );
  }

  const bytes = await fs.readFile(audioPath);
  const filename = path.basename(audioPath);

  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }),
    filename,
  );
  form.append('model', SARVAM_MODEL);
  form.append('language_code', SARVAM_LANGUAGE);
  if (SARVAM_WITH_DIARIZATION) form.append('with_diarization', 'true');
  if (SARVAM_NUM_SPEAKERS) form.append('num_speakers', SARVAM_NUM_SPEAKERS);
  form.append('with_timestamps', 'true');

  const res = await fetch(`${SARVAM_API_BASE}/speech-to-text`, {
    method: 'POST',
    headers: { 'api-subscription-key': apiKey },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Sarvam ${res.status} ${res.statusText} — ${body.slice(0, 400)}`,
    );
  }

  const data = (await res.json()) as SarvamResponse;
  const segments: Segment[] = [];

  const entries = data.diarized_transcript?.entries ?? [];
  if (entries.length > 0) {
    for (const e of entries) {
      const text = (e.transcript ?? '').trim();
      if (!text) continue;
      segments.push({
        start: e.start_time_seconds ?? 0,
        end: e.end_time_seconds ?? 0,
        text,
        speaker: e.speaker_id != null ? String(e.speaker_id) : undefined,
      });
    }
  } else if (data.transcript) {
    segments.push({ start: 0, end: 0, text: data.transcript.trim() });
  }

  const text = segments
    .map((s) => s.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { text, segments };
}

interface SarvamResponse {
  transcript?: string;
  language_code?: string;
  request_id?: string;
  diarized_transcript?: {
    entries: SarvamDiarizedEntry[];
  };
}

interface SarvamDiarizedEntry {
  speaker_id?: string | number;
  transcript?: string;
  start_time_seconds?: number;
  end_time_seconds?: number;
}
