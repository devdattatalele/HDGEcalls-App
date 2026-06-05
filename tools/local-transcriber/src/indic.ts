import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import type { Segment, WhisperResult } from './whisper.ts';
import { clean, romanize } from './postprocess.ts';

/**
 * AI4Bharat IndicConformer-600M backend (Conformer + CTC).
 *
 * Why: tested 2026-06-05 at RTF 0.19× on M3, with real Marathi output (vs
 * Whisper's phonetic hallucinations). MIT-licensed, no per-minute cost.
 *
 * Architecture: a long-running Python daemon owns the loaded model and we
 * talk to it line-by-line over stdin/stdout. Loading the model takes ~8 s
 * so we want to pay that once, not every call.
 *
 * Daemon protocol:
 *   request:  {"audio": "/abs/path/to.wav", "language": "mr", "decoder": "ctc"}
 *   response: {"ok": true, "transcript": "...", "rtf": 0.19, ...}
 *             or
 *             {"ok": false, "error": "..."}
 */

const PYTHON_BIN = process.env.INDIC_PYTHON_BIN ?? '.venv-indic/bin/python';
const DAEMON_SCRIPT = path.resolve(
  process.cwd(),
  'python/indic_conformer_daemon.py',
);
const LANGUAGE = process.env.INDIC_LANGUAGE ?? 'mr';
const DECODER = process.env.INDIC_DECODER ?? 'ctc';
const MODEL_LABEL = process.env.INDIC_CONFORMER_MODEL
  ?? 'ai4bharat/indic-conformer-600m-multilingual';

export function indicProviderLabel(): string {
  return `${MODEL_LABEL}:${DECODER}`;
}

interface DaemonResponse {
  ok: boolean;
  transcript?: string;
  language?: string;
  decoder?: string;
  model?: string;
  audio_sec?: number;
  run_sec?: number;
  rtf?: number;
  error?: string;
}

let daemon: ChildProcessWithoutNullStreams | null = null;
let daemonReadyResolve: (() => void) | null = null;
let daemonReadyPromise: Promise<void> | null = null;
let pendingResolve: ((r: DaemonResponse) => void) | null = null;
let pendingReject: ((e: Error) => void) | null = null;
let inflight: Promise<DaemonResponse> | null = null;
let stdoutBuf = '';

function ensureDaemon(): Promise<void> {
  if (daemon && !daemon.killed) return daemonReadyPromise ?? Promise.resolve();

  daemonReadyPromise = new Promise<void>((resolve) => {
    daemonReadyResolve = resolve;
  });

  const env = { ...process.env };
  // The model lives in HF cache and the offline flag prevents the daemon
  // from blocking on HF Hub round-trips at startup. The user runs the
  // first download once (see python/requirements.txt notes).
  env.HF_HUB_OFFLINE = env.HF_HUB_OFFLINE ?? '1';

  daemon = spawn(PYTHON_BIN, [DAEMON_SCRIPT], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  daemon.stdout.setEncoding('utf8');
  daemon.stdout.on('data', (chunk: string) => {
    stdoutBuf += chunk;
    let nl: number;
    while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line) continue;
      handleLine(line);
    }
  });

  daemon.stderr.setEncoding('utf8');
  daemon.stderr.on('data', (chunk: string) => {
    // Daemon's logs are useful — surface them with a prefix.
    for (const line of chunk.split('\n')) {
      if (line.trim()) console.warn(`[indic-py] ${line}`);
    }
  });

  daemon.on('exit', (code, signal) => {
    console.warn(
      `[indic] daemon exited code=${code} signal=${signal} — will respawn on next call`,
    );
    if (pendingReject) {
      pendingReject(new Error(`indic daemon exited (code=${code})`));
      pendingResolve = pendingReject = null;
      inflight = null;
    }
    daemon = null;
    daemonReadyPromise = null;
    daemonReadyResolve = null;
  });

  return daemonReadyPromise;
}

function handleLine(line: string) {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    console.warn(`[indic] unparseable daemon line: ${line.slice(0, 200)}`);
    return;
  }
  if (msg?.event === 'ready') {
    daemonReadyResolve?.();
    return;
  }
  if (pendingResolve) {
    pendingResolve(msg as DaemonResponse);
    pendingResolve = pendingReject = null;
    inflight = null;
  }
}

async function callDaemon(req: object): Promise<DaemonResponse> {
  await ensureDaemon();
  // Serialise — the daemon does one job at a time. Subsequent calls queue.
  if (inflight) await inflight.catch(() => undefined);
  inflight = new Promise<DaemonResponse>((resolve, reject) => {
    pendingResolve = resolve;
    pendingReject = reject;
    daemon!.stdin.write(JSON.stringify(req) + '\n');
  });
  return inflight;
}

export async function transcribeFileIndic(
  audioPath: string,
): Promise<WhisperResult> {
  const resp = await callDaemon({
    audio: audioPath,
    language: LANGUAGE,
    decoder: DECODER,
  });
  if (!resp.ok) {
    throw new Error(resp.error ?? 'indic daemon error');
  }
  const raw = (resp.transcript ?? '').trim();
  const text = clean(romanize(raw));

  // IndicConformer CTC doesn't emit word/segment timestamps, so we surface
  // a single segment that spans the whole audio. The dashboard's
  // TranscriptView renders this as a paragraph with the duration shown.
  const segments: Segment[] = text
    ? [{ start: 0, end: resp.audio_sec ?? 0, text }]
    : [];

  return { text, segments };
}
