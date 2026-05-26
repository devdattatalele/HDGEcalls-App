export type TranscriptSegment = {
  start: number;
  end: number;
  speaker?: string;
  text: string;
};

export type Transcript = {
  text: string;
  segments?: TranscriptSegment[];
};

export type TranscribeInput = {
  audioUrl: string;
  mime: string;
};

import { transcribe as deepgram } from './deepgram.ts';
import { transcribe as openai } from './openai.ts';
import { transcribe as assemblyai } from './assemblyai.ts';
import { transcribe as stub } from './stub.ts';

export async function transcribe(
  provider: 'deepgram' | 'openai' | 'assemblyai' | 'stub',
  input: TranscribeInput,
): Promise<Transcript> {
  switch (provider) {
    case 'deepgram':
      return deepgram(input);
    case 'openai':
      return openai(input);
    case 'assemblyai':
      return assemblyai(input);
    case 'stub':
    default:
      return stub(input);
  }
}
