import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getGroqClient, getSupportedGroqModel } from '@/lib/groq';
import { YoutubeTranscript } from 'youtube-transcript';

const groq = getGroqClient();

export const maxDuration = 300;

function extractYouTubeId(url: string): string | null {
  const cleanUrl = url.trim();
  const match = cleanUrl.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/
  );
  if (match) return match[1];
  if (/^[\w-]{11}$/.test(cleanUrl)) return cleanUrl;
  return null;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

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

    const { url } = await request.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'YouTube URL is required' }, { status: 400 });
    }

    const videoId = extractYouTubeId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL. Please provide a valid YouTube watch or share link.' },
        { status: 400 }
      );
    }

    // Step 1: Fetch video title & metadata via YouTube oEmbed
    let videoTitle = 'YouTube Video';
    let authorName = 'YouTube';
    try {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
      );
      if (oembedRes.ok) {
        const oembedData = await oembedRes.json();
        if (oembedData.title) videoTitle = oembedData.title;
        if (oembedData.author_name) authorName = oembedData.author_name;
      }
    } catch (e) {
      console.warn('oEmbed fetch error:', e);
    }

    // Step 2: Fetch transcript from YouTube
    let rawSegments: Array<{ text: string; duration: number; offset: number }> = [];
    try {
      rawSegments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    } catch {
      // Fallback to default/any language
      try {
        rawSegments = await YoutubeTranscript.fetchTranscript(videoId);
      } catch (err) {
        return NextResponse.json(
          {
            error:
              'Could not retrieve a transcript for this YouTube video. The video may not have captions/subtitles enabled, or transcripts are restricted.',
          },
          { status: 422 }
        );
      }
    }

    if (!rawSegments || rawSegments.length === 0) {
      return NextResponse.json(
        { error: 'The transcript for this YouTube video is empty or unavailable.' },
        { status: 422 }
      );
    }

    // Calculate approximate duration
    const lastSeg = rawSegments[rawSegments.length - 1];
    const totalDurationSeconds = lastSeg ? Math.round((lastSeg.offset + lastSeg.duration) / 1000) : 0;

    // Step 3: Insert video record into Supabase
    const { data: videoRecord, error: insertVideoError } = await supabase
      .from('videos')
      .insert({
        user_id: user.id,
        title: videoTitle,
        file_name: `https://www.youtube.com/watch?v=${videoId}`,
        file_size: 0,
        storage_path: `youtube:${videoId}`,
        duration: totalDurationSeconds,
        status: 'processing',
      })
      .select()
      .single();

    if (insertVideoError || !videoRecord) {
      console.error('Database insert error:', insertVideoError);
      return NextResponse.json({ error: 'Failed to create video record in database' }, { status: 500 });
    }

    // Step 4: Prepare transcript text for AI analysis
    const transcriptText = rawSegments
      .map((seg) => {
        const startSec = Math.round(seg.offset / 1000);
        const endSec = Math.round((seg.offset + seg.duration) / 1000);
        return `[${formatTime(startSec)} - ${formatTime(endSec)}] ${seg.text.replace(/&amp;#39;/g, "'").replace(/&quot;/g, '"').trim()}`;
      })
      .join('\n');

    // Step 5: Groq LLM Analysis
    const analysisPrompt = `You are an expert video and meeting analyst. Analyze the following YouTube video transcript titled "${videoTitle}" (Creator: ${authorName}).

TRANSCRIPT:
${transcriptText}

Respond with ONLY a valid JSON object (no markdown, no code fences) with the following structure:
{
  "executive_summary": "A concise 2-3 sentence overview of the entire video",
  "detailed_synopsis": "A detailed paragraph-form synopsis covering all key insights and sections discussed",
  "topics": ["topic1", "topic2", ...],
  "important_points": ["point1", "point2", ...],
  "conclusions": "Summary of main conclusions or takeaways",
  "key_moments": [
    {"timestamp": <seconds as number>, "title": "moment title", "description": "brief description"}
  ],
  "meeting_overview": "Overview if this appears to be a presentation, interview, or meeting, otherwise null",
  "meeting_decisions": ["decision or key claim 1", ...],
  "action_items": [
    {"task": "task description or recommendation", "assignee": "Speaker/Presenter", "deadline": "TBD", "priority": "high|medium|low"}
  ],
  "unresolved_questions": ["question or discussion point 1", ...],
  "speakers": [
    {"id": "Speaker 1", "segments": [0, 1, 2]}
  ]
}

IMPORTANT RULES:
- Identify speakers or distinct voices if dialogue/interview cues exist
- All timestamps in key_moments must be numbers in seconds
- Be thorough, specific, and accurate to the transcript content
- Return ONLY valid JSON, no surrounding text`;

    const chatModel = await getSupportedGroqModel(groq);
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: analysisPrompt }],
      model: chatModel,
      temperature: 0.3,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    });

    const analysisText = completion.choices[0]?.message?.content || '{}';
    let analysis: any;
    try {
      analysis = JSON.parse(analysisText);
    } catch {
      analysis = {};
    }

    // Step 6: Map transcript segments with speaker assignments
    const speakerAssignments = analysis.speakers || [];
    const segmentSpeakerMap: Record<number, string> = {};

    speakerAssignments.forEach((speaker: { id: string; segments: number[] }) => {
      (speaker.segments || []).forEach((segIdx: number) => {
        segmentSpeakerMap[segIdx] = speaker.id;
      });
    });

    const transcriptSegments = rawSegments.map((seg, index) => {
      const startSec = Math.round(seg.offset / 1000);
      const endSec = Math.round((seg.offset + seg.duration) / 1000);
      return {
        id: `seg-${index}`,
        start: startSec,
        end: endSec,
        speaker: segmentSpeakerMap[index] || 'Speaker 1',
        text: seg.text.replace(/&amp;#39;/g, "'").replace(/&quot;/g, '"').trim(),
      };
    });

    // Build initial speaker mapping
    const uniqueSpeakers = [...new Set(transcriptSegments.map((s) => s.speaker))] as string[];
    const speakerMapping: Record<string, string> = {};
    uniqueSpeakers.forEach((s) => {
      speakerMapping[s] = s;
    });

    // Step 7: Store analysis in Supabase
    const { error: insertAnalysisError } = await supabase.from('video_analyses').upsert({
      video_id: videoRecord.id,
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
    });

    if (insertAnalysisError) {
      console.error('Error saving analysis:', insertAnalysisError);
    }

    // Step 8: Mark video status as completed
    await supabase
      .from('videos')
      .update({ status: 'completed', duration: totalDurationSeconds })
      .eq('id', videoRecord.id);

    return NextResponse.json({
      success: true,
      videoId: videoRecord.id,
      title: videoTitle,
    });
  } catch (error) {
    console.error('YouTube analysis error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process YouTube video' },
      { status: 500 }
    );
  }
}
