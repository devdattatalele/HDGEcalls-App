import fs from 'node:fs/promises';
import path from 'node:path';
import type { Segment, WhisperResult } from './whisper.ts';

/**
 * Sarvam Saarika transcription backend.
 *
 * Sarvam splits ASR into two products with different shapes:
 *
 *   /speech-to-text            — synchronous, ≤ 30 s audio, no diarization.
 *                                Multipart form.
 *   /speech-to-text/job/v1/…   — asynchronous batch, no length limit, full
 *                                diarization support. 6-step JSON flow:
 *                                  1. POST /speech-to-text/job/v1
 *                                     → job_id, storage_container_type
 *                                  2. POST /speech-to-text/job/v1/upload-files
 *                                     {job_id, files: [name]}
 *                                     → upload_urls[name]   (presigned PUT)
 *                                  3. PUT bytes to that URL
 *                                  4. POST /speech-to-text/job/v1/{id}/start
 *                                  5. GET  /speech-to-text/job/v1/{id}/status
 *                                     (poll for job_state==='Completed')
 *                                  6. POST /speech-to-text/job/v1/download-files
 *                                     {job_id, files: ['0.json']}
 *                                     → download_urls['0.json'] (GET)
 *                                       → final transcript JSON
 *
 * We default to the batch flow because the real-time API caps at 30 s
 * — useless for call recordings. Real-time is only the fallback for
 * very-short audio when batch unexpectedly fails.
 *
 * Docs:
 *   https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/speech-to-text/batch-api
 */

const SARVAM_API_BASE =
  process.env.SARVAM_API_BASE ?? 'https://api.sarvam.ai';
const SARVAM_MODEL = process.env.SARVAM_MODEL ?? 'saarika:v2.5';
const SARVAM_MODE = process.env.SARVAM_MODE ?? 'transcribe';
const SARVAM_LANGUAGE = process.env.SARVAM_LANGUAGE ?? 'unknown';
const SARVAM_WITH_DIARIZATION =
  (process.env.SARVAM_WITH_DIARIZATION ?? '1') !== '0';
const SARVAM_NUM_SPEAKERS = process.env.SARVAM_NUM_SPEAKERS;
const SARVAM_POLL_INTERVAL_MS = Number(
  process.env.SARVAM_POLL_INTERVAL_MS ?? '4000',
);
const SARVAM_POLL_TIMEOUT_MS = Number(
  process.env.SARVAM_POLL_TIMEOUT_MS ?? String(20 * 60 * 1000),
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

  try {
    return await transcribeBatch(audioPath, apiKey);
  } catch (e) {
    console.warn(
      `[sarvam] batch flow failed: ${(e as Error).message ?? e}; trying real-time without diarization (audio must be ≤ 30 s)`,
    );
    return await callRealtime(audioPath, apiKey, false);
  }
}

// -------- Batch (long audio + diarization) --------

async function transcribeBatch(
  audioPath: string,
  apiKey: string,
): Promise<WhisperResult> {
  const filename = sanitiseFilename(path.basename(audioPath));

  // 1. Initiate job
  const job = await sarvamJson(
    'POST',
    '/speech-to-text/job/v1',
    apiKey,
    {
      job_parameters: {
        model: SARVAM_MODEL,
        mode: SARVAM_MODE,
        language_code: SARVAM_LANGUAGE,
        with_timestamps: true,
        with_diarization: SARVAM_WITH_DIARIZATION,
        ...(SARVAM_NUM_SPEAKERS
          ? { num_speakers: Number(SARVAM_NUM_SPEAKERS) }
          : {}),
      },
    },
  ) as InitiateResponse;
  const jobId = job.job_id;
  if (!jobId) throw new Error('initiate: no job_id in response');
  console.log(`[sarvam] batch ${jobId} initiated`);

  // 2. Get presigned upload URL for our one file
  const uploadResp = await sarvamJson(
    'POST',
    '/speech-to-text/job/v1/upload-files',
    apiKey,
    { job_id: jobId, files: [filename] },
  ) as UploadFilesResponse;
  const putUrl = extractUrl(uploadResp.upload_urls?.[filename]);
  if (!putUrl) {
    throw new Error(
      `upload-files: no signed URL for ${filename} in ${JSON.stringify(uploadResp).slice(0, 200)}`,
    );
  }

  // 3. PUT the file to the presigned URL (Azure-style)
  const bytes = await fs.readFile(audioPath);
  const putRes = await fetch(putUrl, {
    method: 'PUT',
    headers: {
      // Azure presigned PUTs require this header; harmless on others.
      'x-ms-blob-type': 'BlockBlob',
      'content-type': 'application/octet-stream',
    },
    body: bytes,
  });
  if (!putRes.ok) {
    const t = await putRes.text().catch(() => '');
    throw new Error(`PUT ${putRes.status} ${putRes.statusText} — ${t.slice(0, 200)}`);
  }

  // 4. Start processing
  await sarvamJson(
    'POST',
    `/speech-to-text/job/v1/${jobId}/start`,
    apiKey,
    undefined,
  );
  console.log(`[sarvam] batch ${jobId} started`);

  // 5. Poll status until terminal
  const start = Date.now();
  let lastState = '';
  while (Date.now() - start < SARVAM_POLL_TIMEOUT_MS) {
    const s = (await sarvamJson(
      'GET',
      `/speech-to-text/job/v1/${jobId}/status`,
      apiKey,
      undefined,
    )) as StatusResponse;
    const state = (s.job_state ?? s.status ?? '').trim();
    if (state !== lastState) {
      console.log(`[sarvam] batch ${jobId} job_state=${state || '(unknown)'}`);
      lastState = state;
    }
    if (state === 'Completed') break;
    if (state === 'Failed') {
      throw new Error(`job ${jobId} failed: ${s.error ?? s.message ?? 'unknown'}`);
    }
    await sleep(SARVAM_POLL_INTERVAL_MS);
  }
  if (lastState !== 'Completed') {
    throw new Error(
      `job ${jobId} did not complete within ${SARVAM_POLL_TIMEOUT_MS / 1000}s (last state=${lastState})`,
    );
  }

  // 6. Get download URL for the result JSON
  const dl = (await sarvamJson(
    'POST',
    '/speech-to-text/job/v1/download-files',
    apiKey,
    { job_id: jobId, files: ['0.json'] },
  )) as DownloadFilesResponse;
  const dlUrl = extractUrl(dl.download_urls?.['0.json'] ?? dl.upload_urls?.['0.json']);
  if (!dlUrl) {
    throw new Error(
      `download-files: no URL for 0.json in ${JSON.stringify(dl).slice(0, 200)}`,
    );
  }
  const transcriptRes = await fetch(dlUrl);
  if (!transcriptRes.ok) {
    throw new Error(`download GET ${transcriptRes.status} ${transcriptRes.statusText}`);
  }
  const transcript = (await transcriptRes.json()) as SarvamTranscriptFile;
  return parseTranscript(transcript);
}

// -------- Real-time (only used for ≤30 s fallback) --------

async function callRealtime(
  audioPath: string,
  apiKey: string,
  withDiarization: boolean,
): Promise<WhisperResult> {
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
  const data = (await res.json()) as SarvamTranscriptFile;
  return parseTranscript(data);
}

// -------- Helpers --------

async function sarvamJson(
  method: 'GET' | 'POST',
  pathPart: string,
  apiKey: string,
  body: unknown,
): Promise<unknown> {
  const init: RequestInit = {
    method,
    headers: {
      'api-subscription-key': apiKey,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${SARVAM_API_BASE}${pathPart}`, init);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`${method} ${pathPart} ${res.status} ${res.statusText} — ${t.slice(0, 400)}`);
  }
  // Some endpoints return 202 with empty body; tolerate that.
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

function extractUrl(entry: unknown): string | null {
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object') {
    const obj = entry as Record<string, unknown>;
    for (const k of ['url', 'signed_url', 'signedUrl', 'href']) {
      if (typeof obj[k] === 'string') return obj[k] as string;
    }
    // Fallback: first string value in the object.
    for (const v of Object.values(obj)) {
      if (typeof v === 'string' && v.startsWith('http')) return v;
    }
  }
  return null;
}

function sanitiseFilename(name: string): string {
  // The upload endpoint uses the filename as a dictionary key; keep it ASCII
  // and free of slashes / special chars.
  const ascii = name.replace(/[^A-Za-z0-9._-]+/g, '_');
  return ascii || 'audio.wav';
}

function parseTranscript(data: SarvamTranscriptFile): WhisperResult {
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

interface InitiateResponse {
  job_id?: string;
  storage_container_type?: string;
  job_parameters?: unknown;
  job_state?: string;
}
interface UploadFilesResponse {
  job_id?: string;
  job_state?: string;
  upload_urls?: Record<string, string | { url?: string; signed_url?: string }>;
}
interface DownloadFilesResponse {
  job_id?: string;
  job_state?: string;
  download_urls?: Record<string, string | { url?: string; signed_url?: string }>;
  upload_urls?: Record<string, string | { url?: string; signed_url?: string }>;
}
interface StatusResponse {
  job_id?: string;
  job_state?: string;
  status?: string;
  error?: string;
  message?: string;
}
interface SarvamTranscriptFile {
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
