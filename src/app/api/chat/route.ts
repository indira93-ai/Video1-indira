import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getAuthenticatedUser } from '@/lib/supabase/server';
import {
  getGroqClient,
  getSupportedGroqModel,
  createSafeChatCompletion,
  compressTranscriptForPrompt,
} from '@/lib/groq';
import { corsHeaders, handleOptions } from '@/lib/api-utils';

const groq = getGroqClient();

export const maxDuration = 300;

export async function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    const adminSupabase = createAdminClient();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: corsHeaders() }
      );
    }

    const { videoId, question } = await request.json().catch(() => ({}));

    if (!videoId || !question) {
      return NextResponse.json(
        { error: 'Missing videoId or question' },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Get the analysis for this video
    const { data: analysis, error: fetchError } = await adminSupabase
      .from('video_analyses')
      .select('*')
      .eq('video_id', videoId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !analysis) {
      return NextResponse.json(
        { error: 'Analysis not found' },
        { status: 404, headers: corsHeaders() }
      );
    }

    // Build bounded context from transcript
    const rawTranscript = (analysis.transcript_segments || [])
      .map((seg: { start: number; speaker: string; text: string }) => {
        const speaker = analysis.speaker_mapping?.[seg.speaker] || seg.speaker;
        return `[${Math.floor(seg.start / 60)}:${Math.floor(seg.start % 60).toString().padStart(2, '0')}] ${speaker}: ${seg.text}`;
      })
      .join('\n');

    const transcriptContext = compressTranscriptForPrompt(rawTranscript, 10000);

    const systemPrompt = `You are an AI assistant helping users understand a video they've uploaded. You have access to the complete transcript and analysis of the video.

VIDEO ANALYSIS:
- Executive Summary: ${analysis.executive_summary || 'N/A'}
- Topics: ${(analysis.topics || []).join(', ')}
- Key Points: ${(analysis.important_points || []).join('; ')}

FULL TRANSCRIPT:
${transcriptContext}

Answer the user's question based ONLY on the video content. Be specific and reference timestamps when relevant. If the answer isn't in the content, say so.`;

    const chatModel = await getSupportedGroqModel(groq);
    const completion = await createSafeChatCompletion(groq, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
      model: chatModel,
      temperature: 0.4,
      max_tokens: 800,
    });

    const answer = completion.choices[0]?.message?.content || "Sorry, I couldn't generate an answer.";

    return NextResponse.json({ answer }, { headers: corsHeaders() });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Chat failed' },
      { status: 500, headers: corsHeaders() }
    );
  }
}
