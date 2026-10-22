import Groq from 'groq-sdk';

export function getGroqClient() {
  return new Groq({
    apiKey: process.env.GROQ_API_KEY,
  });
}

// Preferred chat models in order of capability and availability
const PREFERRED_CHAT_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'openai/gpt-oss-120b',
  'llama-3.1-8b-instant',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b',
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
  cachedModel = 'openai/gpt-oss-120b';
  return cachedModel;
}
