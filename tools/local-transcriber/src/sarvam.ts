import fs from 'node:fs/promises';
import path from 'node:path';
import type { Segment, WhisperResult } from './whisper.ts';

/**
 * Sarvam Saarika transcription backend.
 *
 * Two endpoints:
 *   /speech-to-text           — synchronous, no diarization (≤ 30 min audio)
 *   /speech-to-text/job       — asynchronous batch, supports diarization
 *
 * When SARVAM_WITH_DIARIZATION=1 we go through the batch API (submit +
 * poll). If batch fails for any reason we degrade gracefully to the
 * real-time endpoint with diarization off so the manager still gets a
 * usable transcript on every call.
 *
 * Docs: https://docs.sarvam.ai/api-reference-docs/speech-to-text
 */

const SARVAM_API_BASE =
  process.env.SARVAM_API_BASE ?? 'https://api.sarvam.ai';
const SARVAM_MODEL = process.env.SARVAM_MODEL ?? 'saarika:v2.5';
const SARVAM_LANGUAGE = process.env.SARVAM_LANGUAGE ?? 'unknown';
const SARVAM_WITH_DIARIZATION =
  (process.env.SARVAM_WITH_DIARIZATION ?? '1') !== '0';
const SARVAM_NUM_SPEAKERS = process.env.SARVAM_NUM_SPEAKERS;
const SARVAM_POLL_INTERVAL_MS = Number(
  process.env.SARVAM_POLL_INTERVAL_MS ?? '4000',
);
const SARVAM_POLL_TIMEOUT_MS = Number(
  process.env.SARVAM_POLL_TIMEOUT_MS ?? String(15 * 60 * 1000),
);

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

  if (SARVAM_WITH_DIARIZATION) {
    try {
      const jobId = await submitBatchJob(audioPath, apiKey);
      const data = await pollBatchJob(jobId, apiKey);
      return parseResponse(data);
    } catch (e) {
      console.warn(
        `[sarvam] batch job failed: ${(e as Error).message ?? e}; falling back to real-time without diarization`,
      );
    }
  }

  return await callRealtime(audioPath, apiKey, false);
}

async function callRealtime(
  audioPath: string,
  apiKey: string,
  withDiarization: boolean,
): Promise<WhisperResult> {
  const form = await buildForm(audioPath, withDiarization);
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
  return parseResponse(data);
}

async function submitBatchJob(
  audioPath: string,
  apiKey: string,
): Promise<string> {
  const form = await buildForm(audioPath, SARVAM_WITH_DIARIZATION);
  const res = await fetch(`${SARVAM_API_BASE}/speech-to-text/job`, {
    method: 'POST',
    headers: { 'api-subscription-key': apiKey },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Sarvam job submit ${res.status} ${res.statusText} — ${body.slice(0, 400)}`,
    );
  }

  const data = (await res.json()) as {
    job_id?: string;
    jobId?: string;
    id?: string;
  };
  const jobId = data.job_id ?? data.jobId ?? data.id;
  if (!jobId) {
    throw new Error('Sarvam job submit returned no job id');
  }
  console.log(`[sarvam] batch job submitted: ${jobId}`);
  return jobId;
}

async function pollBatchJob(
  jobId: string,
  apiKey: string,
): Promise<SarvamResponse> {
  const start = Date.now();
  let lastStatus = '';

  while (Date.now() - start < SARVAM_POLL_TIMEOUT_MS) {
    const res = await fetch(
      `${SARVAM_API_BASE}/speech-to-text/job/${jobId}`,
      {
        headers: { 'api-subscription-key': apiKey },
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Sarvam job status ${res.status} ${res.statusText} — ${body.slice(0, 400)}`,
      );
    }

    const data = (await res.json()) as SarvamJobResponse;
    const status = (data.status ?? data.job_status ?? '').toLowerCase();

    if (status !== lastStatus) {
      console.log(
        `[sarvam] batch ${jobId} status=${status || '(unknown)'}`,
      );
      lastStatus = status;
    }

    if (
      status === 'completed' ||
      status === 'success' ||
      status === 'succeeded' ||
      data.transcript ||
      data.diarized_transcript
    ) {
      return data as SarvamResponse;
    }
    if (status === 'failed' || status === 'error') {
      throw new Error(
        `Sarvam batch failed: ${data.error ?? data.message ?? 'unknown reason'}`,
      );
    }

    await sleep(SARVAM_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Sarvam batch job timed out after ${SARVAM_POLL_TIMEOUT_MS / 1000}s`,
  );
}

async function buildForm(
  audioPath: string,
  withDiarization: boolean,
): Promise<FormData> {
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
  if (withDiarization) form.append('with_diarization', 'true');
  if (SARVAM_NUM_SPEAKERS) form.append('num_speakers', SARVAM_NUM_SPEAKERS);
  form.append('with_timestamps', 'true');
  return form;
}

function parseResponse(data: SarvamResponse): WhisperResult {
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface SarvamResponse {
  transcript?: string;
  language_code?: string;
  request_id?: string;
  diarized_transcript?: {
    entries: SarvamDiarizedEntry[];
  };
}

interface SarvamJobResponse extends SarvamResponse {
  status?: string;
  job_status?: string;
  error?: string;
  message?: string;
}

interface SarvamDiarizedEntry {
  speaker_id?: string | number;
  transcript?: string;
  start_time_seconds?: number;
  end_time_seconds?: number;
}
