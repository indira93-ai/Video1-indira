import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getAuthenticatedUser } from '@/lib/supabase/server';
import {
  getGroqClient,
  getSupportedGroqModel,
  createSafeChatCompletion,
  compressTranscriptForPrompt,
  safeJsonParse,
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
    .replace(/&amp;#39;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
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

function parseTimestampToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}

export interface RawSegment {
  text: string;
  duration: number;
  offset: number;
}

export interface TranscriptResult {
  segments: RawSegment[];
  error?: string;
  isAgeRestricted?: boolean;
  noCaptions?: boolean;
}

/**
 * Universal parser for YouTube timedtext responses:
 * Handles JSON format3, XML format3 (<p t="..." d="...">), and classic XML (<text start="..." dur="...">).
 */
export function parseTranscriptData(rawText: string): RawSegment[] {
  const segments: RawSegment[] = [];
  if (!rawText || typeof rawText !== 'string') return segments;

  const trimmed = rawText.trim();

  // 1. JSON format 3
  if (trimmed.startsWith('{') && trimmed.includes('"events"')) {
    try {
      const data = JSON.parse(trimmed);
      if (Array.isArray(data.events)) {
        for (const ev of data.events) {
          if (!ev.segs || !Array.isArray(ev.segs)) continue;
          const text = ev.segs.map((s: any) => s.utf8 || '').join('').trim();
          if (!text || text === '\n') continue;
          segments.push({
            text: cleanHtmlEntities(text),
            offset: Math.round(ev.tStartMs || 0),
            duration: Math.max(1000, Math.round(ev.dDurationMs || 0)),
          });
        }
        if (segments.length > 0) return segments;
      }
    } catch {
      // Continue to XML parsing
    }
  }

  // 2. XML format 3 (<p t="ms" d="ms"><s>word</s></p>)
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = pRegex.exec(trimmed)) !== null) {
    const offset = parseInt(pMatch[1], 10);
    const duration = Math.max(1000, parseInt(pMatch[2], 10));
    const inner = pMatch[3];
    let text = '';
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = sRegex.exec(inner)) !== null) {
      text += sMatch[1];
    }
    if (!text) {
      text = inner.replace(/<[^>]+>/g, '');
    }
    text = cleanHtmlEntities(text).replace(/\s+/g, ' ').trim();
    if (text) {
      segments.push({ text, offset, duration });
    }
  }
  if (segments.length > 0) return segments;

  // 3. Classic XML format (<text start="s" dur="s">content</text>)
  const textRegex = /<text\s+start="([^"]*)"\s+dur="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g;
  let textMatch: RegExpExecArray | null;
  while ((textMatch = textRegex.exec(trimmed)) !== null) {
    const offset = Math.round(parseFloat(textMatch[1]) * 1000);
    const duration = Math.max(1000, Math.round(parseFloat(textMatch[2]) * 1000));
    let text = textMatch[3].replace(/<[^>]+>/g, '');
    text = cleanHtmlEntities(text).replace(/\s+/g, ' ').trim();
    if (text) {
      segments.push({ text, offset, duration });
    }
  }

  return segments;
}

/**
 * Parses user-provided transcripts in various formats:
 * - YouTube copied transcript format (alternating timestamp and text lines)
 * - Inline timestamp format ([00:15] or [00:15 - 00:30] Text)
 * - SRT / WebVTT subtitle format
 * - Plain unstructured text (split into logical ~20s chunks)
 */
export function parseRawUserTranscript(rawText: string): RawSegment[] {
  if (!rawText || typeof rawText !== 'string') return [];
  const clean = cleanHtmlEntities(rawText.trim());
  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const segments: RawSegment[] = [];

  // Pattern 1: YouTube copy-paste where lines alternate:
  // 0:00\nWelcome\n0:05\nToday...
  const timeOnlyRegex = /^\[?(\d{1,2}:(?:\d{2}:)?\d{2}(?:\.\d+)?)\]?$/;
  let timeLineCount = 0;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (timeOnlyRegex.test(lines[i])) timeLineCount++;
  }

  if (timeLineCount >= 2) {
    let currentStart = 0;
    let currentText = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(timeOnlyRegex);
      if (match) {
        if (currentText) {
          const nextStart = parseTimestampToSeconds(match[1]);
          const duration = Math.max(1, nextStart - currentStart);
          segments.push({
            text: currentText.trim(),
            offset: currentStart * 1000,
            duration: duration * 1000,
          });
          currentStart = nextStart;
          currentText = '';
        } else {
          currentStart = parseTimestampToSeconds(match[1]);
        }
      } else {
        currentText = currentText ? `${currentText} ${line}` : line;
      }
    }
    if (currentText) {
      segments.push({
        text: currentText.trim(),
        offset: currentStart * 1000,
        duration: 5000,
      });
    }
    if (segments.length > 0) return segments;
  }

  // Pattern 2: Lines starting with timestamps, e.g.:
  // [00:15] Hello everyone
  // [00:15 - 00:30] Speaker 1: Good morning
  const inlineTimeRegex = /^\[?(\d{1,2}:(?:\d{2}:)?\d{2}(?:\.\d+)?)\]?\s*(?:[-–—]\s*\[?(\d{1,2}:(?:\d{2}:)?\d{2})\]?)?\s*(.*)$/;
  let inlineMatches = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (inlineTimeRegex.test(lines[i])) inlineMatches++;
  }

  if (inlineMatches >= 2 || (lines.length === 1 && inlineMatches === 1)) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(inlineTimeRegex);
      if (m && m[3]?.trim()) {
        const start = parseTimestampToSeconds(m[1]);
        const end = m[2] ? parseTimestampToSeconds(m[2]) : start + 5;
        segments.push({
          text: m[3].trim(),
          offset: start * 1000,
          duration: Math.max(1000, (end - start) * 1000),
        });
      }
    }
    if (segments.length > 0) return segments;
  }

  // Pattern 3: Plain text / paragraphs without timestamps
  // Break into ~20s chunks for rich timeline analysis
  let runningSec = 0;
  const CHUNK_DURATION = 20;
  for (const line of lines) {
    if (line.length < 5) continue;
    segments.push({
      text: line,
      offset: runningSec * 1000,
      duration: CHUNK_DURATION * 1000,
    });
    runningSec += CHUNK_DURATION;
  }

  return segments;
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
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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

async function fetchYouTubeCaptions(videoId: string): Promise<TranscriptResult> {
  let isAgeRestricted = false;
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
            hl: 'en',
            gl: 'US',
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
          playabilityReason = playability.reason || 'Sign-in required';
          if (/age|bot|sign in|inappropriate|verify/i.test(playabilityReason || '')) {
            isAgeRestricted = true;
          }
        } else if (playability.status === 'ERROR' || playability.status === 'UNPLAYABLE') {
          playabilityReason = playability.reason || 'This video is unavailable or removed';
        }
      }

      const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(captionTracks) && captionTracks.length > 0) {
        // Sort tracks so English is checked first, then all remaining tracks
        const sortedTracks = [...captionTracks].sort((a: any, b: any) => {
          const aIsEn = a.languageCode === 'en' || a.languageCode?.startsWith('en');
          const bIsEn = b.languageCode === 'en' || b.languageCode?.startsWith('en');
          return aIsEn === bIsEn ? 0 : aIsEn ? -1 : 1;
        });

        for (const track of sortedTracks) {
          if (!track?.baseUrl) continue;
          try {
            const trackRes = await resilientFetch(track.baseUrl);
            if (trackRes.ok) {
              const text = await trackRes.text();
              const parsed = parseTranscriptData(text);
              if (parsed.length > 0) {
                return { segments: parsed };
              }
            }

            // Retry track with fmt=srv3 if empty
            const srv3Res = await resilientFetch(`${track.baseUrl}&fmt=srv3`);
            if (srv3Res.ok) {
              const text = await srv3Res.text();
              const parsed = parseTranscriptData(text);
              if (parsed.length > 0) {
                return { segments: parsed };
              }
            }
          } catch {
            // Try next track
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
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (pageRes.ok) {
      const html = await pageRes.text();

      // Check if web page indicates age restriction or login required
      if (/class="g-recaptcha"|sign in to confirm|confirm your age/i.test(html)) {
        isAgeRestricted = true;
      }

      const match = html.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]+?});(?:var\s|window\[|<)/);
      if (match) {
        const playerResponse = JSON.parse(match[1]);
        const playability = playerResponse?.playabilityStatus;
        if (playability?.status === 'LOGIN_REQUIRED' || /age|bot|sign in|inappropriate/i.test(playability?.reason || '')) {
          isAgeRestricted = true;
          playabilityReason = playability?.reason || playabilityReason;
        }

        const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(captionTracks) && captionTracks.length > 0) {
          const sortedTracks = [...captionTracks].sort((a: any, b: any) => {
            const aIsEn = a.languageCode === 'en' || a.languageCode?.startsWith('en');
            const bIsEn = b.languageCode === 'en' || b.languageCode?.startsWith('en');
            return aIsEn === bIsEn ? 0 : aIsEn ? -1 : 1;
          });

          for (const track of sortedTracks) {
            if (!track?.baseUrl) continue;
            try {
              const trackRes = await resilientFetch(track.baseUrl);
              if (trackRes.ok) {
                const text = await trackRes.text();
                const parsed = parseTranscriptData(text);
                if (parsed.length > 0) {
                  return { segments: parsed };
                }
              }
            } catch {
              // try next track
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('Web scrape caption fallback error:', err);
  }

  // Construct helpful, actionable error message conforming to requirements
  if (isAgeRestricted || (playabilityReason && /sign in|age|bot|verify|inappropriate/i.test(playabilityReason))) {
    return {
      segments: [],
      isAgeRestricted: true,
      error:
        'This YouTube video is age-restricted (sign-in required). YouTube protects this content from automated access. Please upload the video file directly or provide its transcript to generate your AI summary.',
    };
  }

  return {
    segments: [],
    noCaptions: true,
    error:
      'No transcript or closed captions are available for this YouTube video. Please upload the video file directly or provide its transcript to generate your AI summary.',
  };
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
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('ytdl download timeout')), 10000)),
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
    const userTranscript = body?.transcript;
    const customTitle = body?.title;

    let videoId: string | null = null;
    if (url && typeof url === 'string') {
      videoId = extractYouTubeId(url);
    }

    let videoTitle = customTitle?.trim() || 'Video Summary';
    let authorName = 'Presenter';
    let storagePath = `transcript:${Date.now()}`;
    let fileName = 'Provided Transcript';

    // If a valid YouTube ID was extracted, enrich with metadata and video player link
    if (videoId) {
      const meta = await fetchYouTubeMetadata(videoId);
      videoTitle = customTitle?.trim() || meta.title;
      authorName = meta.author;
      storagePath = `youtube:${videoId}`;
      fileName = `https://www.youtube.com/watch?v=${videoId}`;
    }

    let rawSegments: RawSegment[] = [];

    // Mode A: User provided their own transcript directly
    if (userTranscript && typeof userTranscript === 'string' && userTranscript.trim().length > 0) {
      rawSegments = parseRawUserTranscript(userTranscript);
      if (rawSegments.length === 0) {
        return NextResponse.json(
          { error: 'The provided transcript text is empty or could not be parsed. Please check your transcript and try again.' },
          { status: 400, headers: corsHeaders() }
        );
      }
    } else {
      // Mode B: Extract transcript from YouTube URL
      if (!url || typeof url !== 'string') {
        return NextResponse.json(
          { error: 'YouTube URL or transcript text is required.' },
          { status: 400, headers: corsHeaders() }
        );
      }

      if (!videoId) {
        return NextResponse.json(
          { error: 'Invalid YouTube URL. Please provide a valid YouTube watch, share, or shorts link.' },
          { status: 400, headers: corsHeaders() }
        );
      }

      const captionResult = await fetchYouTubeCaptions(videoId);
      rawSegments = captionResult.segments;

      // Optional fallback: Audio stream + Groq Whisper for non-age-restricted videos without captions
      if ((!rawSegments || rawSegments.length === 0) && !captionResult.isAgeRestricted) {
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

      // If captions still unavailable, return clear, actionable response
      if (!rawSegments || rawSegments.length === 0) {
        return NextResponse.json(
          {
            error:
              captionResult.error ||
              'Unable to access this YouTube video. Please upload the video file directly or provide its transcript to generate your summary.',
            isAgeRestricted: !!captionResult.isAgeRestricted,
            noCaptions: !!captionResult.noCaptions,
            videoTitle,
            videoId,
          },
          { status: 422, headers: corsHeaders() }
        );
      }
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
        file_name: fileName,
        file_size: 0,
        storage_path: storagePath,
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
    const promptTranscriptText = compressTranscriptForPrompt(fullTranscriptText, 8000);

    // Step 5: Groq LLM Analysis
    const analysisPrompt = `You are an expert video and meeting analyst. Analyze the following video transcript titled "${videoTitle}" (Presenter: ${authorName}).

TRANSCRIPT:
${promptTranscriptText}

Respond with ONLY a valid JSON object (no markdown, no surrounding text) with the following structure:
{
  "executive_summary": "A concise 2-3 sentence overview of the entire video",
  "detailed_synopsis": "A focused 1-2 paragraph synopsis covering all key insights and sections discussed",
  "topics": ["topic1", "topic2", "topic3"],
  "important_points": ["point1", "point2", "point3"],
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
  "speakers": ["Speaker 1"]
}

IMPORTANT RULES:
- Keep the response concise, informative, and properly formatted
- All timestamps in key_moments must be numbers in seconds
- Return ONLY valid JSON, no code fences`;

    const chatModel = await getSupportedGroqModel(groq);
    const completion = await createSafeChatCompletion(groq, {
      messages: [{ role: 'user', content: analysisPrompt }],
      model: chatModel,
      temperature: 0.3,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
    });

    const analysisText = completion.choices?.[0]?.message?.content || '{}';
    const analysis: any = safeJsonParse(analysisText, {});

    // Step 6: Map transcript segments with speaker assignments
    const speakerAssignments = analysis.speakers || [];
    const segmentSpeakerMap: Record<number, string> = {};

    if (Array.isArray(speakerAssignments)) {
      speakerAssignments.forEach((speaker: any, idx: number) => {
        if (speaker && typeof speaker === 'object' && Array.isArray(speaker.segments)) {
          const spkId = speaker.id || `Speaker ${idx + 1}`;
          speaker.segments.forEach((segIdx: number) => {
            segmentSpeakerMap[segIdx] = spkId;
          });
        }
      });
    }

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
    const rawSpeakerNames = Array.isArray(speakerAssignments)
      ? speakerAssignments.map((s: any) => (typeof s === 'string' ? s : s?.id || 'Speaker 1'))
      : ['Speaker 1'];
    const uniqueSpeakers = [
      ...new Set([...rawSpeakerNames, ...transcriptSegments.map((s) => s.speaker)]),
    ] as string[];

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
      { error: error instanceof Error ? error.message : 'Failed to process video' },
      { status: 500, headers: corsHeaders() }
    );
  }
}
