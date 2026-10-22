import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getGroqClient, getSupportedGroqModel } from '@/lib/groq';

const groq = getGroqClient();

export const maxDuration = 300; // 5 minutes for Vercel Pro, adjust if needed

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;
    const videoId = formData.get('videoId') as string;

    if (!audioFile || !videoId) {
      return NextResponse.json({ error: 'Missing audio file or videoId' }, { status: 400 });
    }

    // Update video status to processing
    await supabase
      .from('videos')
      .update({ status: 'processing' })
      .eq('id', videoId)
      .eq('user_id', user.id);

    // Step 1: Transcribe audio with Groq Whisper
    const transcription = await groq.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-large-v3',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const segments = (transcription as any).segments || [];

    // Step 2: Build transcript text for LLM analysis
    const transcriptText = segments
      .map((seg: { start?: number; end?: number; text?: string }) =>
        `[${formatTime(seg.start || 0)} - ${formatTime(seg.end || 0)}] ${(seg.text || '').trim()}`
      )
      .join('\n');

    // Step 3: Generate comprehensive analysis with Groq Llama
    const analysisPrompt = `You are an expert video/meeting analyst. Analyze the following transcript and provide a comprehensive, structured analysis.

TRANSCRIPT:
${transcriptText}

Respond with ONLY a valid JSON object (no markdown, no code fences) with the following structure:
{
  "executive_summary": "A concise 2-3 sentence overview of the entire content",
  "detailed_synopsis": "A detailed paragraph-form synopsis covering all main points discussed",
  "topics": ["topic1", "topic2", ...],
  "important_points": ["point1", "point2", ...],
  "conclusions": "Summary of conclusions reached",
  "key_moments": [
    {"timestamp": <seconds>, "title": "moment title", "description": "brief description"}
  ],
  "meeting_overview": "Overview if this appears to be a meeting, otherwise null",
  "meeting_decisions": ["decision1", "decision2", ...],
  "action_items": [
    {"task": "task description", "assignee": "Speaker X", "deadline": "mentioned deadline or TBD", "priority": "high|medium|low"}
  ],
  "unresolved_questions": ["question1", "question2", ...],
  "speakers": [
    {"id": "Speaker 1", "segments": [0, 1, 5, 8]},
    {"id": "Speaker 2", "segments": [2, 3, 4, 6, 7, 9]}
  ]
}

IMPORTANT RULES:
- Identify different speakers by analyzing speech patterns, context shifts, and dialogue cues
- Assign segments to speakers (use segment indices starting from 0)
- If it's not a meeting, still provide synopsis, topics, and key moments
- All timestamps should be in seconds (numbers)
- Be thorough and detailed in your analysis
- Return ONLY valid JSON, no other text`;

    const chatModel = await getSupportedGroqModel(groq);
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: analysisPrompt }],
      model: chatModel,
      temperature: 0.3,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    });

    const analysisText = completion.choices[0]?.message?.content || '{}';
    let analysis;
    try {
      analysis = JSON.parse(analysisText);
    } catch {
      analysis = {};
    }

    // Step 4: Build transcript segments with speaker assignments
    const speakerAssignments = analysis.speakers || [];
    const segmentSpeakerMap: Record<number, string> = {};

    speakerAssignments.forEach((speaker: { id: string; segments: number[] }) => {
      (speaker.segments || []).forEach((segIdx: number) => {
        segmentSpeakerMap[segIdx] = speaker.id;
      });
    });

    const transcriptSegments = segments.map((seg: { start?: number; end?: number; text?: string }, index: number) => ({
      id: `seg-${index}`,
      start: seg.start || 0,
      end: seg.end || 0,
      speaker: segmentSpeakerMap[index] || `Speaker 1`,
      text: (seg.text || '').trim(),
    }));

    // Build initial speaker mapping
    const uniqueSpeakers = [...new Set(transcriptSegments.map((s: { speaker: string }) => s.speaker))] as string[];
    const speakerMapping: Record<string, string> = {};
    uniqueSpeakers.forEach((s) => {
      speakerMapping[s] = s;
    });

    // Step 5: Save analysis to database
    const { error: insertError } = await supabase.from('video_analyses').upsert({
      video_id: videoId,
      user_id: user.id,
      executive_summary: analysis.executive_summary || null,
      detailed_synopsis: analysis.detailed_synopsis || null,
      topics: analysis.topics || [],
      important_points: analysis.important_points || [],
      conclusions: analysis.conclusions || null,
      key_moments: analysis.key_moments || [],
      meeting_overview: analysis.meeting_overview || null,
      meeting_decisions: analysis.meeting_decisions || [],
      action_items: analysis.action_items || [],
      unresolved_questions: analysis.unresolved_questions || [],
      transcript_segments: transcriptSegments,
      speaker_mapping: speakerMapping,
    }, { onConflict: 'video_id' });

    if (insertError) {
      console.error('Database insert error:', insertError);
      await supabase
        .from('videos')
        .update({ status: 'error', error_message: 'Failed to save analysis' })
        .eq('id', videoId);
      return NextResponse.json({ error: 'Failed to save analysis' }, { status: 500 });
    }

    // Update video status to completed
    await supabase
      .from('videos')
      .update({ status: 'completed' })
      .eq('id', videoId);

    return NextResponse.json({
      success: true,
      segmentCount: transcriptSegments.length,
      speakerCount: uniqueSpeakers.length,
    });
  } catch (error) {
    console.error('Analysis error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
