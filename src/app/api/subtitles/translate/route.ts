import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getGroqClient, getSupportedGroqModel } from '@/lib/groq';
import { TranscriptSegment } from '@/lib/types';

const groq = getGroqClient();

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { segments, targetLanguage } = (await request.json()) as {
      segments: TranscriptSegment[];
      targetLanguage: string;
    };

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json({ error: 'Segments array is required' }, { status: 400 });
    }

    if (!targetLanguage) {
      return NextResponse.json({ error: 'targetLanguage is required' }, { status: 400 });
    }

    // If English, return original segments directly
    if (targetLanguage.toLowerCase() === 'english' || targetLanguage.toLowerCase() === 'en') {
      return NextResponse.json({ success: true, segments, language: 'English' });
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
        const prompt = `You are an expert subtitle translator. Translate each item in the following JSON array into ${targetLanguage}.
Maintain the exact same "id" and provide the translated subtitle text under "text".
Guidelines:
- Match the conversational tone, meaning, and rhythm of speech.
- Ensure the translation is natural and culturally accurate.
- Keep subtitle length concise and readable.
- Return ONLY a valid JSON array of objects: [{"id": "...", "text": "..."}, ...]. Do not include markdown codeblocks or other text.

Input:
${JSON.stringify(batch)}`;

        try {
          const res = await groq.chat.completions.create({
            model: chatModel,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
          });

          const rawContent = res.choices[0]?.message?.content || '[]';
          // Clean possible markdown code fences
          const cleaned = rawContent
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();

          const parsed = JSON.parse(cleaned) as Array<{ id: string; text: string }>;
          if (Array.isArray(parsed)) {
            parsed.forEach((item) => {
              if (item.id && typeof item.text === 'string') {
                translationMap[item.id] = item.text.trim();
              }
            });
          }
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

    return NextResponse.json({
      success: true,
      language: targetLanguage,
      segments: translatedSegments,
    });
  } catch (error) {
    console.error('Subtitle translation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Translation failed' },
      { status: 500 }
    );
  }
}
