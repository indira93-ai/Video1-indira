import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/server';
import { getGroqClient, getSupportedGroqModel } from '@/lib/groq';
import { TranscriptSegment } from '@/lib/types';
import { corsHeaders, handleOptions } from '@/lib/api-utils';

const groq = getGroqClient();

export const maxDuration = 120;

export async function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: corsHeaders() }
      );
    }

    const { segments, targetLanguage, sourceLanguage } = (await request.json().catch(() => ({}))) as {
      segments: TranscriptSegment[];
      targetLanguage: string;
      sourceLanguage?: string;
    };

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json(
        { error: 'Segments array is required' },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!targetLanguage) {
      return NextResponse.json(
        { error: 'targetLanguage is required' },
        { status: 400, headers: corsHeaders() }
      );
    }

    // If target language is same as source language or 'Original', return original segments directly
    const cleanTarget = targetLanguage.trim().toLowerCase();
    const cleanSource = (sourceLanguage || '').trim().toLowerCase();
    if (cleanTarget === 'original' || (cleanSource && cleanTarget === cleanSource)) {
      return NextResponse.json(
        { success: true, segments, language: targetLanguage },
        { headers: corsHeaders() }
      );
    }

    const chatModel = await getSupportedGroqModel(groq);

    // Batch segments to avoid token truncation
    const BATCH_SIZE = 35;
    const batches: Array<Array<{ id: string; text: string }>> = [];

    for (let i = 0; i < segments.length; i += BATCH_SIZE) {
      batches.push(
        segments.slice(i, i + BATCH_SIZE).map((s) => ({
          id: s.id,
          text: s.text,
        }))
      );
    }

    const translationMap: Record<string, string> = {};

    await Promise.all(
      batches.map(async (batch) => {
        const fromInfo = sourceLanguage ? `from ${sourceLanguage} ` : 'from English ';
        const systemMessage = `You are an expert subtitle translator. Translate English source text accurately into the user's selected dropdown language (${targetLanguage}). Maintain a natural, conversational tone that matches educational video content. Keep technical terms like "Two Minute Classroom" and "SMART method" clear or phonetically accurate in the target script, and ensure the translated lines tightly align with the original timestamps.`;

        const userPrompt = `Translate each item in the following JSON array ${fromInfo}into ${targetLanguage}.
Maintain the exact same "id" and provide the natural translated subtitle text under "text".

Requirements:
- Maintain a natural, conversational tone that matches educational video content.
- Keep technical terms like "Two Minute Classroom" and "SMART method", acronyms, and proper nouns clear or phonetically accurate in the target script.
- Ensure the translated lines tightly align with original timestamps and timing so subtitles synchronize accurately.
- Return ONLY a valid JSON object in the format: {"translations": [{"id": "...", "text": "..."}, ...]}.

Input:
${JSON.stringify(batch)}`;

        try {
          const res = await groq.chat.completions.create({
            model: chatModel,
            messages: [
              { role: 'system', content: systemMessage },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.2,
            response_format: { type: 'json_object' },
          });

          const rawContent = res.choices[0]?.message?.content || '{}';
          const cleaned = rawContent
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();

          const parsed = JSON.parse(cleaned);
          const list: Array<{ id: string; text: string }> = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.translations)
            ? parsed.translations
            : Array.isArray(parsed?.subtitles)
            ? parsed.subtitles
            : [];

          list.forEach((item) => {
            if (item.id && typeof item.text === 'string') {
              translationMap[item.id] = item.text.trim();
            }
          });
        } catch (batchErr) {
          console.error(`Error translating batch to ${targetLanguage}:`, batchErr);
        }
      })
    );

    // Reconstruct full segments with translated text
    const translatedSegments: TranscriptSegment[] = segments.map((seg) => ({
      ...seg,
      text: translationMap[seg.id] || seg.text,
    }));

    return NextResponse.json(
      {
        success: true,
        language: targetLanguage,
        segments: translatedSegments,
      },
      { headers: corsHeaders() }
    );
  } catch (error) {
    console.error('Subtitle translation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Translation failed' },
      { status: 500, headers: corsHeaders() }
    );
  }
}
