import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { transcribeFile } from './whisper.ts';
import { downloadToTmp, convertToWav16k, cleanupDir } from './audio.ts';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const SUPABASE_URL = required('SUPABASE_URL');
const SERVICE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');
const POLL_SEC = Number(process.env.POLL_INTERVAL_SEC ?? '10');
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? '2');
const PROVIDER_LABEL = `whisper.cpp:${path
  .basename(process.env.WHISPER_MODEL ?? 'ggml-small.bin')
  .replace(/\.bin$/, '')}`;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runOnce = process.argv.includes('--once');

async function main() {
  console.log(`[transcriber] starting — provider=${PROVIDER_LABEL}`);
  console.log(`[transcriber] polling every ${POLL_SEC}s (batch ${BATCH_SIZE})`);

  while (true) {
    try {
      const processed = await pass();
      if (processed > 0) console.log(`[transcriber] processed ${processed} call(s)`);
    } catch (e) {
      console.error('[transcriber] pass failed:', e);
    }
    if (runOnce) return;
    await sleep(POLL_SEC * 1000);
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
    await processCall(row).catch(async (e) => {
      console.error(`[transcriber] call ${row.id} failed:`, e);
      await supabase
        .from('calls')
        .update({ transcription_status: 'failed' })
        .eq('id', row.id);
      await supabase.from('transcription_errors').insert({
        call_id: row.id,
        provider: PROVIDER_LABEL,
        error: String(e?.message ?? e),
      });
    });
  }
  return rows.length;
}

async function processCall(row: {
  id: string;
  recording_storage_path: string | null;
}) {
  if (!row.recording_storage_path) return;

  // Claim the row so other workers / passes don't grab it.
  const { error: claimErr } = await supabase
    .from('calls')
    .update({ transcription_status: 'processing' })
    .eq('id', row.id)
    .eq('transcription_status', 'pending');
  if (claimErr) throw claimErr;

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
    const wav = await convertToWav16k(downloaded, workDir);
    const result = await transcribeFile(wav);

    const { error: updErr } = await supabase
      .from('calls')
      .update({
        transcript: result.text,
        transcript_segments: result.segments,
        transcript_provider: PROVIDER_LABEL,
        transcription_status: 'done',
      })
      .eq('id', row.id);
    if (updErr) throw updErr;

    console.log(
      `[transcriber] done ${row.id} (${result.text.length} chars, ${result.segments.length} segs)`,
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
