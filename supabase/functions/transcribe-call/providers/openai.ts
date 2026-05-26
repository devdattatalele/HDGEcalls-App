import type { TranscribeInput, Transcript } from './index.ts';

// @ts-expect-error Deno global.
const API_KEY = Deno.env.get('OPENAI_API_KEY');
// @ts-expect-error Deno global.
const MODEL = Deno.env.get('OPENAI_TRANSCRIBE_MODEL') ?? 'whisper-1';

export async function transcribe(input: TranscribeInput): Promise<Transcript> {
  if (!API_KEY) throw new Error('OPENAI_API_KEY not set');

  // Whisper API requires a multipart upload of the audio bytes.
  const audioRes = await fetch(input.audioUrl);
  if (!audioRes.ok) throw new Error(`Audio fetch ${audioRes.status}`);
  const audioBlob = await audioRes.blob();

  const form = new FormData();
  form.append('file', audioBlob, 'audio');
  form.append('model', MODEL);
  form.append('response_format', 'verbose_json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI ${res.status}: ${errText}`);
  }
  const data = (await res.json()) as WhisperResponse;
  return {
    text: data.text ?? '',
    segments:
      data.segments?.map((s) => ({ start: s.start, end: s.end, text: s.text })) ??
      [],
  };
}

type WhisperResponse = {
  text?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
};
