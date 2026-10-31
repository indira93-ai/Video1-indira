import Groq from 'groq-sdk';
import { jsonrepair } from 'jsonrepair';

export function getGroqClient() {
  return new Groq({
    apiKey: process.env.GROQ_API_KEY || 'gsk_placeholder_build_time_key',
  });
}

// Preferred chat models in order of capability and availability
const PREFERRED_CHAT_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
  'llama-3.1-8b-instant',
];

let cachedModel: string | null = null;

export async function getSupportedGroqModel(groq: Groq): Promise<string> {
  // If user explicitly configured GROQ_MODEL in env, respect it
  if (process.env.GROQ_MODEL) {
    return process.env.GROQ_MODEL;
  }

  if (cachedModel) {
    return cachedModel;
  }

  try {
    const list = await groq.models.list();
    const available = new Set((list.data || []).map((m) => m.id));

    for (const model of PREFERRED_CHAT_MODELS) {
      if (available.has(model)) {
        cachedModel = model;
        return model;
      }
    }

    // If none of preferred match, select any non-audio/guard chat model
    const candidate = (list.data || []).find(
      (m) =>
        !m.id.includes('whisper') &&
        !m.id.includes('guard') &&
        !m.id.includes('orpheus')
    );

    if (candidate) {
      cachedModel = candidate.id;
      return candidate.id;
    }
  } catch (err) {
    console.warn('Failed to query Groq models list, using fallback:', err);
  }

  // Safe fallback if listing fails
  cachedModel = 'llama-3.3-70b-versatile';
  return cachedModel;
}

/**
 * Compresses video transcript to stay safely within Groq's 8,000 TPM limit
 * while preserving key introduction, middle dialogue, and concluding remarks.
 */
export function compressTranscriptForPrompt(
  transcript: string,
  maxChars: number = 8000
): string {
  if (!transcript || transcript.length <= maxChars) {
    return transcript || '';
  }
  const lines = transcript.split('\n');
  if (lines.length <= 10) {
    return transcript.slice(0, maxChars);
  }

  const targetLines = Math.floor(lines.length * (maxChars / transcript.length));
  const headCount = Math.max(3, Math.floor(targetLines * 0.25));
  const tailCount = Math.max(3, Math.floor(targetLines * 0.25));
  const middleCount = Math.max(4, targetLines - headCount - tailCount);

  const head = lines.slice(0, headCount);
  const tail = lines.slice(-tailCount);
  const middleSlice = lines.slice(headCount, lines.length - tailCount);

  const step = Math.max(1, Math.ceil(middleSlice.length / middleCount));
  const middle = middleSlice.filter((_, idx) => idx % step === 0);

  return [
    ...head,
    '... [dialogue continues] ...',
    ...middle,
    '... [concluding remarks] ...',
    ...tail,
  ].join('\n');
}

/**
 * Reliably parses JSON even if slightly truncated by using jsonrepair
 */
export function safeJsonParse<T = any>(raw: string, fallback: T): T {
  if (!raw || typeof raw !== 'string') return fallback;
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    try {
      const repaired = jsonrepair(cleaned);
      return JSON.parse(repaired) as T;
    } catch {
      return fallback;
    }
  }
}

/**
 * Resilient completion wrapper that clamps max_tokens to prevent 413/429 TPM limit errors
 * and automatically retries with a fallback model or without strict json_object validation if needed.
 */
export async function createSafeChatCompletion(
  groq: Groq,
  options: any
): Promise<any> {
  const maxTokens = Math.min(options.max_tokens || 2500, 2800);
  const primaryModel = options.model || (await getSupportedGroqModel(groq));

  const runWithModel = async (
    modelToUse: string,
    tokensLimit: number,
    opts: any = options
  ): Promise<any> => {
    return (await groq.chat.completions.create({
      ...opts,
      model: modelToUse,
      max_tokens: tokensLimit,
      stream: false,
    })) as any;
  };

  try {
    return await runWithModel(primaryModel, maxTokens);
  } catch (err: any) {
    const errorStr = (err?.message || '').toLowerCase();

    // 1. Handle json_validate_failed (when max tokens was reached before closing the document)
    const isJsonValidateFailed =
      errorStr.includes('json_validate_failed') ||
      errorStr.includes('failed to generate json') ||
      errorStr.includes('failed to validate json');

    if (isJsonValidateFailed) {
      console.warn(
        'Groq json_validate_failed encountered. Retrying without strict json_object enforcement...'
      );
      const { response_format, ...safeOptions } = options;
      try {
        return await runWithModel(primaryModel, 2500, safeOptions);
      } catch (retryErr: any) {
        return await runWithModel('openai/gpt-oss-20b', 2200, safeOptions);
      }
    }

    // 2. Handle TPM / RPM rate limits
    const isRateOrSizeLimit =
      err?.status === 413 ||
      err?.status === 429 ||
      errorStr.includes('rate_limit_exceeded') ||
      errorStr.includes('request too large') ||
      errorStr.includes('tokens per minute') ||
      errorStr.includes('tpm');

    if (isRateOrSizeLimit) {
      console.warn(
        `Groq rate/size limit hit with ${primaryModel}, retrying with fallback model...`
      );
      // Wait 1.2s to clear transient token burst
      await new Promise((r) => setTimeout(r, 1200));

      const fallbackModel =
        primaryModel === 'openai/gpt-oss-120b'
          ? 'openai/gpt-oss-20b'
          : 'openai/gpt-oss-120b';

      try {
        return await runWithModel(fallbackModel, 1800);
      } catch (secondErr: any) {
        console.warn(`Fallback to ${fallbackModel} failed, trying 1500 tokens on qwen/qwen3.8-27b...`);
        return await runWithModel('qwen/qwen3.8-27b', 1500);
      }
    }

    throw err;
  }
}
