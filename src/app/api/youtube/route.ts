import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getAuthenticatedUser } from '@/lib/supabase/server';
import {
  getGroqClient,
  getSupportedGroqModel,
  createSafeChatCompletion,
  compressTranscriptForPrompt,
} from '@/lib/groq';
import { YoutubeTranscript } from 'youtube-transcript';
import { fetch as undiciFetch, Agent } from 'undici';
import { toFile } from 'groq-sdk';
import { Ytdl } from '@distube/ytdl-core';
import { corsHeaders, handleOptions } from '@/lib/api-utils';

const groq = getGroqClient();

export const maxDuration = 300;

export async function OPTIONS() {
  return handleOptions();
}

// Resilient connection agent disabling IPv6 preference to prevent connect timeouts on dual-stack/tethered networks
const resilientAgent = new Agent({
  connect: {
    autoSelectFamily: false,
    timeout: 15000,
  },
});

function resilientFetch(url: string | URL | Request, init: any = {}): Promise<Response> {
  try {
    return undiciFetch(url as any, {
      ...init,
      dispatcher: resilientAgent,
    }) as unknown as Promise<Response>;
  } catch {
    return fetch(url as any, init);
  }
}

function cleanHtmlEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;#39;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .trim();
}

function extractYouTubeId(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const cleanUrl = url.trim();

  // If already an 11-character video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(cleanUrl)) return cleanUrl;

  const patterns = [
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/))([a-zA-Z0-9_-]{11})/i,
    /[?&]v=([a-zA-Z0-9_-]{11})/i,
  ];

  for (const pattern of patterns) {
    const match = cleanUrl.match(pattern);
    if (match && match[1]) return match[1];
  }

  return null;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

async function fetchYouTubeMetadata(videoId: string): Promise<{ title: string; author: string }> {
  let title = 'YouTube Video';
  let author = 'YouTube';

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}&format=json`;

    const oembedRes = await resilientFetch(oembedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (oembedRes.ok) {
      const oembedData = (await oembedRes.json()) as any;
      if (oembedData?.title) title = oembedData.title;
      if (oembedData?.author_name) author = oembedData.author_name;
    }
  } catch (e) {
    console.warn('oEmbed fetch warning:', e);
  }

  return { title, author };
}

interface RawSegment {
  text: string;
  duration: number;
  offset: number;
}

interface TranscriptResult {
  segments: RawSegment[];
  error?: string;
}

async function fetchYouTubeCaptions(videoId: string): Promise<TranscriptResult> {
  let playabilityReason: string | null = null;

  // Tier 1: Fast YouTube captions via resilient fetch (English)
  try {
    const res = await YoutubeTranscript.fetchTranscript(videoId, {
      fetch: resilientFetch as any,
      lang: 'en',
    });
    if (res && res.length > 0) {
      return {
        segments: res.map((s) => ({
          text: cleanHtmlEntities(s.text),
          duration: Math.round(s.duration),
          offset: Math.round(s.offset),
        })),
      };
    }
  } catch {
    // Continue to Tier 2
  }

  // Tier 2: YouTube captions via resilient fetch (any available language track)
  try {
    const res = await YoutubeTranscript.fetchTranscript(videoId, {
      fetch: resilientFetch as any,
    });
    if (res && res.length > 0) {
      return {
        segments: res.map((s) => ({
          text: cleanHtmlEntities(s.text),
          duration: Math.round(s.duration),
          offset: Math.round(s.offset),
        })),
      };
    }
  } catch {
    // Continue to Tier 3
  }

  // Tier 3: Direct YouTube InnerTube Android Player API
  try {
    const playerRes = await resilientFetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
          },
        },
        videoId,
      }),
    });

    if (playerRes.ok) {
      const playerData = (await playerRes.json()) as any;
      const playability = playerData?.playabilityStatus;

      if (playability) {
        if (playability.status === 'LOGIN_REQUIRED') {
          playabilityReason = playability.reason || 'This video requires login or is private';
        } else if (playability.status === 'ERROR' || playability.status === 'UNPLAYABLE') {
          playabilityReason = playability.reason || 'This video is unavailable or removed';
        }
      }

      const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(captionTracks) && captionTracks.length > 0) {
        const track =
          captionTracks.find((t: any) => t.languageCode === 'en' || t.languageCode?.startsWith('en')) ||
          captionTracks[0];

        if (track?.baseUrl) {
          const trackRes = await resilientFetch(track.baseUrl);
          if (trackRes.ok) {
            const xml = await trackRes.text();
            const segments: RawSegment[] = [];
            const regex = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
            let match: RegExpExecArray | null;
            while ((match = regex.exec(xml)) !== null) {
              segments.push({
                text: cleanHtmlEntities(match[3]),
                offset: Math.round(parseFloat(match[1]) * 1000),
                duration: Math.round(parseFloat(match[2]) * 1000),
              });
            }
            if (segments.length > 0) {
              return { segments };
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('InnerTube caption fallback error:', err);
  }

  // Tier 4: Web Scraping fallback for ytInitialPlayerResponse
  try {
    const pageRes = await resilientFetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (pageRes.ok) {
      const html = await pageRes.text();
      const match = html.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]+?});(?:var\s|window\[|<)/);
      if (match) {
        const playerResponse = JSON.parse(match[1]);
        const playability = playerResponse?.playabilityStatus;
        if (playability?.reason && !playabilityReason) {
          playabilityReason = playability.reason;
        }

        const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(captionTracks) && captionTracks.length > 0) {
          const track =
            captionTracks.find((t: any) => t.languageCode === 'en' || t.languageCode?.startsWith('en')) ||
            captionTracks[0];

          if (track?.baseUrl) {
            const trackRes = await resilientFetch(track.baseUrl);
            if (trackRes.ok) {
              const xml = await trackRes.text();
              const segments: RawSegment[] = [];
              const regex = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
              let matchSeg: RegExpExecArray | null;
              while ((matchSeg = regex.exec(xml)) !== null) {
                segments.push({
                  text: cleanHtmlEntities(matchSeg[3]),
                  offset: Math.round(parseFloat(matchSeg[1]) * 1000),
                  duration: Math.round(parseFloat(matchSeg[2]) * 1000),
                });
              }
              if (segments.length > 0) {
                return { segments };
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('Web scrape caption fallback error:', err);
  }

  let errorMsg =
    'No transcript or closed captions are available for this YouTube video. Please ensure the video has closed captions (CC) or auto-generated subtitles enabled.';
  if (playabilityReason) {
    if (/sign in|age/i.test(playabilityReason)) {
      errorMsg = `Unable to access this YouTube video: This video is age-restricted (${playabilityReason}).`;
    } else if (/private/i.test(playabilityReason)) {
      errorMsg = `Unable to access this YouTube video: This video is private or requires sign-in. Please ensure the video is public.`;
    } else {
      errorMsg = `Unable to access this YouTube video: ${playabilityReason}`;
    }
  }

  return { segments: [], error: errorMsg };
}

async function downloadYouTubeAudio(videoId: string): Promise<Buffer | null> {
  try {
    const ytdl = new Ytdl();
    const streamPromise = ytdl.download(`https://www.youtube.com/watch?v=${videoId}`, {
      filter: { hasAudio: true, hasVideo: false },
      quality: 'lowestaudio',
    });

    const stream = await Promise.race([
      streamPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('ytdl download timeout')), 15000)),
    ]);

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const MAX_BYTES = 24 * 1024 * 1024; // 24MB cap for Groq Whisper limit

    return new Promise((resolve) => {
      stream.on('data', (chunk: Buffer) => {
        if (totalBytes + chunk.length <= MAX_BYTES) {
          chunks.push(chunk);
          totalBytes += chunk.length;
        } else {
          stream.destroy();
          resolve(Buffer.concat(chunks));
        }
      });

      stream.on('end', () => {
        resolve(chunks.length > 0 ? Buffer.concat(chunks) : null);
      });

      stream.on('error', (err) => {
        console.warn('ytdl audio stream warning:', err.message);
        resolve(chunks.length > 0 ? Buffer.concat(chunks) : null);
      });
    });
  } catch (err) {
    console.warn('downloadYouTubeAudio warning:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    const adminSupabase = createAdminClient();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in to analyze videos.' },
        { status: 401, headers: corsHeaders() }
      );
    }

    const body = await request.json().catch(() => ({}));
    const url = body?.url;
    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'YouTube URL is required' },
        { status: 400, headers: corsHeaders() }
      );
    }

    const videoId = extractYouTubeId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL. Please provide a valid YouTube watch, share, or shorts link.' },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Step 1: Fetch video title & creator via YouTube oEmbed
    const { title: videoTitle, author: authorName } = await fetchYouTubeMetadata(videoId);

    // Step 2: Fetch transcript from YouTube captions (multi-tiered fallback)
    const captionResult = await fetchYouTubeCaptions(videoId);
    let rawSegments = captionResult.segments;

    // Optional Step 2b: Fallback to audio stream + Groq Whisper if captions are missing
    if (!rawSegments || rawSegments.length === 0) {
      const audioBuffer = await downloadYouTubeAudio(videoId);
      if (audioBuffer && audioBuffer.length > 0) {
        try {
          const audioFile = await toFile(audioBuffer, 'audio.m4a', { type: 'audio/m4a' });
          const transcription = await groq.audio.transcriptions.create({
            file: audioFile,
            model: 'whisper-large-v3',
            response_format: 'verbose_json',
            timestamp_granularities: ['segment'],
          });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const whisperSegments = (transcription as any).segments || [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rawSegments = whisperSegments.map((s: any) => ({
            text: cleanHtmlEntities(s.text || ''),
            duration: Math.max(1000, Math.round(((s.end || 0) - (s.start || 0)) * 1000)),
            offset: Math.round((s.start || 0) * 1000),
          }));
        } catch (whisperErr) {
          console.error('Groq Whisper audio fallback error:', whisperErr);
        }
      }
    }

    // If still no segments, return the specific, actionable error
    if (!rawSegments || rawSegments.length === 0) {
      return NextResponse.json(
        {
          error:
            captionResult.error ||
            'Unable to retrieve transcripts for this YouTube video. Please ensure the video is public and has closed captions or subtitles enabled.',
        },
        { status: 422, headers: corsHeaders() }
      );
    }

    // Calculate approximate duration
    const lastSeg = rawSegments[rawSegments.length - 1];
    const totalDurationSeconds = lastSeg ? Math.round((lastSeg.offset + lastSeg.duration) / 1000) : 0;

    // Step 3: Insert initial video record into Supabase
    const { data: videoRecord, error: insertVideoError } = await adminSupabase
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
      return NextResponse.json(
        { error: 'Failed to create video record in database' },
        { status: 500, headers: corsHeaders() }
      );
    }

    // Step 4: Prepare transcript text for Groq LLM analysis
    const fullTranscriptText = rawSegments
      .map((seg) => {
        const startSec = Math.round(seg.offset / 1000);
        const endSec = Math.round((seg.offset + seg.duration) / 1000);
        return `[${formatTime(startSec)} - ${formatTime(endSec)}] ${seg.text}`;
      })
      .join('\n');

    // Compress transcript context to safely stay within Groq's 8,000 TPM limit
    const promptTranscriptText = compressTranscriptForPrompt(fullTranscriptText, 12000);

    // Step 5: Groq LLM Analysis
    const analysisPrompt = `You are an expert video and meeting analyst. Analyze the following YouTube video transcript titled "${videoTitle}" (Creator: ${authorName}).

TRANSCRIPT:
${promptTranscriptText}

Respond with ONLY a valid JSON object (no markdown, no code fences) with the following structure:
{
  "executive_summary": "A concise 2-3 sentence overview of the entire video",
  "detailed_synopsis": "A detailed paragraph-form synopsis covering all key insights and sections discussed",
  "topics": ["topic1", "topic2"],
  "important_points": ["point1", "point2"],
  "conclusions": "Summary of main conclusions or takeaways",
  "key_moments": [
    {"timestamp": 0, "title": "moment title", "description": "brief description"}
  ],
  "meeting_overview": "Overview if this appears to be a presentation, interview, or meeting, otherwise null",
  "meeting_decisions": ["decision or key claim 1"],
  "action_items": [
    {"task": "task description or recommendation", "assignee": "Speaker/Presenter", "deadline": "TBD", "priority": "high"}
  ],
  "unresolved_questions": ["question or discussion point 1"],
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
    const completion = await createSafeChatCompletion(groq, {
      messages: [{ role: 'user', content: analysisPrompt }],
      model: chatModel,
      temperature: 0.3,
      max_tokens: 2000,
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
        text: seg.text,
      };
    });

    // Build initial speaker mapping
    const uniqueSpeakers = [...new Set(transcriptSegments.map((s) => s.speaker))] as string[];
    const speakerMapping: Record<string, string> = {
      _detected_language: 'English',
    };
    uniqueSpeakers.forEach((s) => {
      speakerMapping[s] = s;
    });

    // Step 7: Store analysis in Supabase
    const { error: insertAnalysisError } = await adminSupabase.from('video_analyses').upsert({
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
    await adminSupabase
      .from('videos')
      .update({ status: 'completed', duration: totalDurationSeconds })
      .eq('id', videoRecord.id);

    return NextResponse.json(
      {
        success: true,
        videoId: videoRecord.id,
        title: videoTitle,
      },
      { headers: corsHeaders() }
    );
  } catch (error) {
    console.error('YouTube analysis error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process YouTube video' },
      { status: 500, headers: corsHeaders() }
    );
  }
}
