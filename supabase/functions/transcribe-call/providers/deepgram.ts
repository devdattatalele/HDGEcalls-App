import type { TranscribeInput, Transcript, TranscriptSegment } from './index.ts';

// @ts-expect-error Deno global.
const API_KEY = Deno.env.get('DEEPGRAM_API_KEY');
// @ts-expect-error Deno global.
const MODEL = Deno.env.get('DEEPGRAM_MODEL') ?? 'nova-2-general';
// @ts-expect-error Deno global.
const LANGUAGE = Deno.env.get('DEEPGRAM_LANGUAGE') ?? 'multi';

export async function transcribe(input: TranscribeInput): Promise<Transcript> {
  if (!API_KEY) throw new Error('DEEPGRAM_API_KEY not set');

  const params = new URLSearchParams({
    model: MODEL,
    language: LANGUAGE,
    smart_format: 'true',
    diarize: 'true',
    punctuate: 'true',
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ url: input.audioUrl }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Deepgram ${res.status}: ${errText}`);
  }
  const data = (await res.json()) as DeepgramResponse;
  const alt = data.results?.channels?.[0]?.alternatives?.[0];
  const text = alt?.transcript ?? '';
  const segments: TranscriptSegment[] = (alt?.words ?? [])
    .reduce<TranscriptSegment[]>((acc, w) => {
      const last = acc[acc.length - 1];
      const speaker = w.speaker !== undefined ? `spk_${w.speaker}` : undefined;
      if (last && last.speaker === speaker && w.start - last.end < 1.5) {
        last.end = w.end;
        last.text += ' ' + (w.punctuated_word ?? w.word);
      } else {
        acc.push({
          start: w.start,
          end: w.end,
          speaker,
          text: w.punctuated_word ?? w.word,
        });
      }
      return acc;
    }, []);
  return { text, segments };
}

type DeepgramWord = {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  speaker?: number;
};
type DeepgramResponse = {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        words?: DeepgramWord[];
      }>;
    }>;
  };
};
