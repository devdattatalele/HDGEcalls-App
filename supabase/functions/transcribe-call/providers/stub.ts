import type { TranscribeInput, Transcript } from './index.ts';

// Placeholder provider so the end-to-end pipeline can be tested before a real
// transcription provider is chosen. Returns a fixed string.
export async function transcribe(_input: TranscribeInput): Promise<Transcript> {
  return {
    text: '[stub transcript — set TRANSCRIPTION_PROVIDER to deepgram/openai/assemblyai once a key is configured]',
    segments: [],
  };
}
