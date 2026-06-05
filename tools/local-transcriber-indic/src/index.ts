import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { transcribeFile as transcribeWhisper } from './whisper.ts';
import { transcribeFileIndic, indicProviderLabel } from './indic.ts';
import { transcribeFileSarvam, sarvamProviderLabel } from './sarvam.ts';
import { downloadToTmp, convertToWav16k, cleanupDir } from './audio.ts';
import { startHealthServer, stats } from './server.ts';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const WORKER_ID = process.env.WORKER_ID ?? os.hostname() ?? 'unknown-worker';
const BACKEND = (process.env.TRANSCRIPTION_BACKEND ?? 'indic').toLowerCase();
const transcribeFn =
  BACKEND === 'sarvam'
    ? transcribeFileSarvam
    : BACKEND === 'whisper'
      ? transcribeWhisper
      : transcribeFileIndic;

// Layer 3 (whisper.cpp code-switch) only adds value alongside the indic
// stack — sarvam already preserves English code-switches natively, and
// running whisper would just slow that backend down for no gain.
const INCLUDE_WHISPER_LAYER =
  BACKEND === 'indic' && (process.env.INCLUDE_WHISPER_LAYER ?? '1') !== '0';

const SUPABASE_URL = required('SUPABASE_URL');
const SERVICE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');
const POLL_SEC = Number(process.env.POLL_INTERVAL_SEC ?? '10');
const POLL_ACTIVE_SEC = Number(process.env.POLL_INTERVAL_ACTIVE_SEC ?? '3');
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? '2');
const STUCK_SEC = Number(process.env.STUCK_PROCESSING_SEC ?? '600');
const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? '7777');
const PROVIDER_LABEL =
  BACKEND === 'sarvam'
    ? sarvamProviderLabel()
    : BACKEND === 'whisper'
      ? `whisper.cpp:${path
          .basename(process.env.WHISPER_MODEL ?? 'ggml-small.bin')
          .replace(/\.bin$/, '')}`
      : indicProviderLabel();

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runOnce = process.argv.includes('--once');

async function main() {
  console.log(`[transcriber] starting — provider=${PROVIDER_LABEL}`);
  console.log(
    `[transcriber] poll idle=${POLL_SEC}s active=${POLL_ACTIVE_SEC}s batch=${BATCH_SIZE} stuck=${STUCK_SEC}s`,
  );
  console.log(`[transcriber] backend=${BACKEND} worker_id=${WORKER_ID}`);
  if (BACKEND === 'sarvam') {
    console.log(
      `[transcriber] sarvam model=${process.env.SARVAM_MODEL ?? 'saarika:v2.5'} lang=${process.env.SARVAM_LANGUAGE ?? 'unknown'} diarize=${process.env.SARVAM_WITH_DIARIZATION ?? '1'}`,
    );
  } else if (BACKEND === 'whisper') {
    console.log(
      `[transcriber] whisper language=${process.env.WHISPER_LANGUAGE ?? 'auto'} romanize=${process.env.ROMANIZE_HINDI ?? '1'}`,
    );
    console.log(
      `[transcriber] whisper extra args: ${process.env.WHISPER_EXTRA_ARGS ?? '(none)'}`,
    );
  } else {
    console.log(
      `[transcriber] indic asr=${process.env.INDIC_CONFORMER_MODEL ?? 'ai4bharat/indic-conformer-600m-multilingual'} translate=${process.env.INDIC_TRANSLATE_TO_ENGLISH ?? '1'} lang=${process.env.INDIC_LANGUAGE ?? 'mr'} decoder=${process.env.INDIC_DECODER ?? 'ctc'} romanize=${process.env.ROMANIZE_HINDI ?? '1'}`,
    );
  }
  stats.provider = PROVIDER_LABEL;
  stats.started_at = new Date().toISOString();

  if (HEALTH_PORT > 0) {
    startHealthServer(HEALTH_PORT);
  }

  while (true) {
    let processed = 0;
    try {
      await recoverStuck();
      processed = await pass();
      if (processed > 0) console.log(`[transcriber] processed ${processed} call(s)`);
      stats.last_pass_at = new Date().toISOString();
      stats.last_pass_processed = processed;
    } catch (e) {
      console.error('[transcriber] pass failed:', e);
      stats.last_error = String((e as Error)?.message ?? e);
    }
    await publishHeartbeat();
    if (runOnce) return;
    const sleepMs = (processed > 0 ? POLL_ACTIVE_SEC : POLL_SEC) * 1000;
    await sleep(sleepMs);
  }
}

/**
 * Upsert our liveness + counters into public.transcriber_status. The
 * dashboard reads this (via the calls.hdgelabs.com FastAPI) to render the
 * "Transcriber online" pill — no inbound network path to the Mac required.
 */
async function publishHeartbeat(): Promise<void> {
  try {
    await supabase.from('transcriber_status').upsert(
      {
        worker_id: WORKER_ID,
        provider: stats.provider,
        started_at: stats.started_at,
        last_heartbeat: new Date().toISOString(),
        last_pass_at: stats.last_pass_at,
        jobs_in_flight: stats.jobs_in_flight,
        jobs_done_today: stats.jobs_done_today,
        jobs_failed_today: stats.jobs_failed_today,
        last_error: stats.last_error,
      },
      { onConflict: 'worker_id' },
    );
  } catch (e) {
    console.warn('[transcriber] heartbeat publish failed:', (e as Error)?.message ?? e);
  }
}

/**
 * Reclaim rows that were claimed ('processing') but never finished —
 * usually because the worker crashed mid-job. Flip them back to 'pending' so
 * the next pass picks them up.
 */
async function recoverStuck(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_SEC * 1000).toISOString();
  const { data, error } = await supabase
    .from('calls')
    .update({ transcription_status: 'pending' })
    .eq('transcription_status', 'processing')
    .lt('updated_at', cutoff)
    .select('id');
  if (error) {
    console.warn('[transcriber] stuck-recovery failed:', error.message);
    return;
  }
  if (data && data.length > 0) {
    console.log(`[transcriber] recovered ${data.length} stuck row(s) -> pending`);
  }
}

async function pass(): Promise<number> {
  const { data: rows, error } = await supabase
    .from('calls')
    .select('id, user_id, device_id, recording_storage_path, recording_mime')
    .eq('transcription_status', 'pending')
    .not('recording_storage_path', 'is', null)
    .order('started_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw error;
  if (!rows || rows.length === 0) return 0;

  for (const row of rows) {
    stats.jobs_in_flight += 1;
    try {
      await processCall(row);
      stats.jobs_done_today += 1;
    } catch (e) {
      console.error(`[transcriber] call ${row.id} failed:`, e);
      stats.last_error = String((e as Error)?.message ?? e);
      stats.jobs_failed_today += 1;
      await supabase
        .from('calls')
        .update({ transcription_status: 'failed' })
        .eq('id', row.id);
      await supabase.from('transcription_errors').insert({
        call_id: row.id,
        provider: PROVIDER_LABEL,
        error: String((e as Error)?.message ?? e),
      });
    } finally {
      stats.jobs_in_flight = Math.max(0, stats.jobs_in_flight - 1);
    }
  }
  return rows.length;
}

async function processCall(row: {
  id: string;
  recording_storage_path: string | null;
}) {
  if (!row.recording_storage_path) return;

  // Claim the row so other workers / passes don't grab it. The matching
  // .eq('transcription_status','pending') guards against races — if another
  // worker already grabbed it, our update touches 0 rows and we fall through.
  const { data: claimed, error: claimErr } = await supabase
    .from('calls')
    .update({ transcription_status: 'processing' })
    .eq('id', row.id)
    .eq('transcription_status', 'pending')
    .select('id');
  if (claimErr) throw claimErr;
  if (!claimed || claimed.length === 0) {
    // Already claimed by someone else; skip silently.
    return;
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'calling-'));
  try {
    const { data: signed, error: urlErr } = await supabase.storage
      .from('call-recordings')
      .createSignedUrl(row.recording_storage_path, 60 * 10);
    if (urlErr || !signed) throw urlErr ?? new Error('no signed url');

    const downloaded = await downloadToTmp(
      signed.signedUrl,
      workDir,
      path.basename(row.recording_storage_path),
    );
    // 16 kHz mono PCM WAV — both backends consume the same canonical form.
    const wav = await convertToWav16k(downloaded, workDir);

    // Run primary backend + (optionally) whisper.cpp in parallel. Whisper
    // runs in a separate process so the two transcribers don't fight over
    // the same model — total wall ≈ max(indic, whisper).
    const [primaryResult, mixedResult] = await Promise.all([
      transcribeFn(wav),
      INCLUDE_WHISPER_LAYER
        ? transcribeWhisper(wav).catch((e) => {
            console.warn(
              `[transcriber] whisper layer failed: ${(e as Error)?.message ?? e}`,
            );
            return null;
          })
        : Promise.resolve(null),
    ]);

    // Indic backend supplies the IndicTrans2 English layer; whisper.cpp
    // leaves it undefined. Layer 3 (mixed/code-switch) is whisper output.
    const { error: updErr } = await supabase
      .from('calls')
      .update({
        transcript: primaryResult.text,
        transcript_segments: primaryResult.segments,
        transcript_english: primaryResult.textEnglish ?? null,
        transcript_mixed: mixedResult?.text ?? null,
        transcript_provider: PROVIDER_LABEL,
        transcription_status: 'done',
      })
      .eq('id', row.id);
    if (updErr) throw updErr;

    console.log(
      `[transcriber] done ${row.id} primary=${primaryResult.text.length}ch en=${(primaryResult.textEnglish ?? '').length}ch mixed=${(mixedResult?.text ?? '').length}ch`,
    );
  } finally {
    await cleanupDir(workDir);
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[transcriber] missing env var ${name} — see .env.example`);
    process.exit(1);
  }
  return v;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error('[transcriber] fatal:', e);
  process.exit(1);
});
