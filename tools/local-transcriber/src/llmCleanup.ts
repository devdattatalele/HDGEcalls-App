import type { WhisperResult, Segment } from './whisper.ts';

/**
 * Gemini-powered cleanup pass for any ASR backend.
 *
 * Both Sarvam Saarika and whisper.cpp produce noisy Hinglish output:
 *   - Tech/brand terms get mangled ("Figma" -> "Pigma", "GPT" -> alphabet soup)
 *   - Hallucinated English phrases on unclear audio ("Okay boss, I love you")
 *   - Names of people / companies mishear
 *
 * We send the diarized segments to Gemini 2.5 Flash with a strict prompt that
 * asks it to fix obvious errors while preserving structure (speaker IDs,
 * timestamps, segment boundaries). Free tier covers >>5000 min/month at
 * pilot volumes.
 *
 * Set LLM_CLEANUP=1 + GEMINI_API_KEY in .env to enable.
 *
 * If the call fails for any reason (network, quota, malformed JSON) we log
 * and return the original result unchanged — cleanup is best-effort.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS ?? '90000');
const GEMINI_API_BASE =
  process.env.GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com';

export function llmCleanupEnabled(): boolean {
  return (process.env.LLM_CLEANUP ?? '0') !== '0' && !!GEMINI_API_KEY;
}

const SYSTEM_PROMPT = `You are cleaning up an automated speech-to-text transcript of a phone call in Hinglish (mix of Hindi/Marathi and English). The ASR makes predictable errors:

- Hallucinates English phrases on unclear audio ("Okay boss, I love you", "Hello Private Hospital")
- Mishears tech/business terms: Figma <- Pigma, GPT/Claude <- alphabet letters, JD <- gibberish, Photoshop, Canva, ChatGPT, Google AI Studio, UI, UX, AI, API, CRM, KPI, SaaS
- Mistranscribes numbers ("three months" <- "Three March") and proper nouns (names, company names)
- Drops or duplicates short words on segment boundaries

RULES:
1. Return STRICT JSON: {"segments":[{"i":0,"text":"..."}, ...]} — one entry per input segment, same "i" indices, in the same order.
2. ONLY include segments whose text you changed. Unchanged segments must be OMITTED from the response.
3. Preserve language mix — keep Hindi/Marathi in Roman script if input was Roman, in Devanagari if input was Devanagari. Do NOT translate.
4. When you fix English code-switches, use the standard spelling of the tech term (Figma, GPT, Claude).
5. If a segment looks like a hallucination of a phrase that doesn't fit the surrounding business-call context, replace it with a best-guess of what was said, OR with an empty string if you genuinely can't tell.
6. Do NOT add content the caller didn't say. Do NOT merge or split segments. Do NOT change speaker IDs.
7. Output JSON only, no prose, no markdown fences.`;

interface CleanupResponse {
  segments?: Array<{ i?: number; text?: string }>;
}

export async function cleanupWithGemini(
  result: WhisperResult,
): Promise<WhisperResult> {
  if (!llmCleanupEnabled()) return result;
  if (!result.segments?.length) return result;

  const startMs = Date.now();
  const input = result.segments.map((s, i) => ({
    i,
    speaker: s.speaker ?? null,
    text: s.text,
  }));

  const userPrompt =
    `Here are the diarized segments. Fix obvious errors per the rules.\n\n` +
    JSON.stringify({ segments: input });

  try {
    const fixes = await callGemini(userPrompt);
    if (!fixes?.segments?.length) {
      console.log(`[llm-cleanup] no edits returned in ${Date.now() - startMs}ms`);
      return result;
    }
    const fixed = applyFixes(result.segments, fixes.segments);
    const text = fixed
      .map((s) => s.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    console.log(
      `[llm-cleanup] ${fixes.segments.length}/${result.segments.length} segments edited in ${Date.now() - startMs}ms`,
    );
    return { ...result, text, segments: fixed };
  } catch (e) {
    console.warn(
      `[llm-cleanup] failed (${Date.now() - startMs}ms): ${(e as Error)?.message ?? e}`,
    );
    return result;
  }
}

function applyFixes(
  original: Segment[],
  edits: Array<{ i?: number; text?: string }>,
): Segment[] {
  const byIndex = new Map<number, string>();
  for (const e of edits) {
    if (typeof e.i !== 'number') continue;
    if (typeof e.text !== 'string') continue;
    byIndex.set(e.i, e.text.trim());
  }
  return original
    .map((s, i) => {
      const newText = byIndex.get(i);
      return newText !== undefined ? { ...s, text: newText } : s;
    })
    .filter((s) => s.text.length > 0);
}

async function callGemini(userPrompt: string): Promise<CleanupResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${GEMINI_API_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY!)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gemini ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini: empty response');
    return JSON.parse(text) as CleanupResponse;
  } finally {
    clearTimeout(timer);
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
}
