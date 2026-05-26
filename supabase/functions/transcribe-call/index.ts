// Supabase Edge Function: transcribe-call
// Deploy: supabase functions deploy transcribe-call --no-verify-jwt
//
// Two invocation paths:
//   1. Storage webhook (configure in Supabase Studio → Database → Webhooks →
//      "storage.objects" INSERT/UPDATE on bucket call-recordings). Payload
//      shape: { record: { bucket_id, name, ... } }
//   2. Direct invoke from the app: supabase.functions.invoke('transcribe-call',
//      { body: { call_id } })

// @ts-expect-error Deno runtime — types not available in this repo.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
// @ts-expect-error Deno-style remote import.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { transcribe, type Transcript } from './providers/index.ts';

// @ts-expect-error Deno global.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// @ts-expect-error Deno global.
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// @ts-expect-error Deno global.
const PROVIDER = (Deno.env.get('TRANSCRIPTION_PROVIDER') ?? 'stub') as
  | 'stub'
  | 'deepgram'
  | 'openai'
  | 'assemblyai';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

serve(async (req: Request) => {
  try {
    const body = await req.json().catch(() => ({}));
    const callId = await resolveCallId(body);
    if (!callId) return json({ error: 'no call_id resolvable' }, 400);

    const { data: call, error: callErr } = await admin
      .from('calls')
      .select('id, recording_storage_path, recording_mime, user_id')
      .eq('id', callId)
      .single();
    if (callErr || !call) return json({ error: callErr?.message ?? 'not found' }, 404);
    if (!call.recording_storage_path) {
      await admin
        .from('calls')
        .update({ transcription_status: 'skipped' })
        .eq('id', callId);
      return json({ ok: true, skipped: true });
    }

    await admin
      .from('calls')
      .update({ transcription_status: 'processing' })
      .eq('id', callId);

    const { data: signed, error: urlErr } = await admin.storage
      .from('call-recordings')
      .createSignedUrl(call.recording_storage_path, 60 * 30);
    if (urlErr || !signed) throw new Error(urlErr?.message ?? 'no signed url');

    const result: Transcript = await transcribe(PROVIDER, {
      audioUrl: signed.signedUrl,
      mime: call.recording_mime ?? 'audio/mp4',
    });

    await admin
      .from('calls')
      .update({
        transcript: result.text,
        transcript_segments: result.segments ?? null,
        transcript_provider: PROVIDER,
        transcription_status: 'done',
      })
      .eq('id', callId);

    return json({ ok: true, callId });
  } catch (e) {
    // Best-effort failure logging.
    const message = e instanceof Error ? e.message : String(e);
    try {
      const body = await req.clone().json().catch(() => ({}));
      const callId = await resolveCallId(body);
      if (callId) {
        await admin
          .from('calls')
          .update({ transcription_status: 'failed' })
          .eq('id', callId);
        await admin.from('transcription_errors').insert({
          call_id: callId,
          provider: PROVIDER,
          error: message,
        });
      }
    } catch {
      // ignore
    }
    return json({ error: message }, 500);
  }
});

async function resolveCallId(body: unknown): Promise<string | null> {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.call_id === 'string') return b.call_id;

  // Storage webhook shape: { record: { bucket_id, name } }
  const record = b.record as Record<string, unknown> | undefined;
  if (record && typeof record.name === 'string') {
    // path is {user_id}/{device_id}/{call_id}.{ext}
    const filename = record.name.split('/').pop() ?? '';
    const callId = filename.replace(/\.[^.]+$/, '');
    if (callId) return callId;
  }
  return null;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
