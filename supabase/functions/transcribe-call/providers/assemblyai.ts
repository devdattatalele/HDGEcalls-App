import type { TranscribeInput, Transcript, TranscriptSegment } from './index.ts';

// @ts-expect-error Deno global.
const API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY');
// @ts-expect-error Deno global.
const LANGUAGE = Deno.env.get('ASSEMBLYAI_LANGUAGE') ?? 'en';

export async function transcribe(input: TranscribeInput): Promise<Transcript> {
  if (!API_KEY) throw new Error('ASSEMBLYAI_API_KEY not set');

  const startRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      authorization: API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: input.audioUrl,
      speaker_labels: true,
      language_code: LANGUAGE,
    }),
  });
  if (!startRes.ok) {
    throw new Error(`AssemblyAI start ${startRes.status}: ${await startRes.text()}`);
  }
  const { id } = (await startRes.json()) as { id: string };

  // Poll for completion. Cap at ~5 min wall-clock to stay within edge limits.
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const poll = await fetch(
      `https://api.assemblyai.com/v2/transcript/${id}`,
      { headers: { authorization: API_KEY } },
    );
    const data = (await poll.json()) as AssemblyResponse;
    if (data.status === 'completed') {
      const segments: TranscriptSegment[] =
        data.utterances?.map((u) => ({
          start: u.start / 1000,
          end: u.end / 1000,
          speaker: u.speaker,
          text: u.text,
        })) ?? [];
      return { text: data.text ?? '', segments };
    }
    if (data.status === 'error') {
      throw new Error(`AssemblyAI: ${data.error}`);
    }
  }
  throw new Error('AssemblyAI: timed out polling for transcript');
}

type AssemblyResponse = {
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;
  error?: string;
  utterances?: Array<{
    start: number;
    end: number;
    speaker: string;
    text: string;
  }>;
};
