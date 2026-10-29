import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { getGroqClient, getSupportedGroqModel } from '@/lib/groq';
import { corsHeaders, handleOptions } from '@/lib/api-utils';
import { toFile } from 'groq-sdk';

const groq = getGroqClient();

export const maxDuration = 300;

export async function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  let activeVideoId: string | null = null;
  const adminSupabase = createAdminClient();

  try {
    // 1. Authenticate user via either Authorization Bearer token or cookie session
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in to analyze videos.' },
        { status: 401, headers: corsHeaders() }
      );
    }

    // 2. Parse request payload (supports JSON or multipart/form-data)
    let videoId: string | null = null;
    let requestedLanguage = 'auto';
    let audioFileFromClient: File | null = null;

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}));
      videoId = body?.videoId || null;
      requestedLanguage = ((body?.language as string) || 'auto').trim();
    } else {
      const formData = await request.formData();
      videoId = (formData.get('videoId') as string) || null;
      requestedLanguage = ((formData.get('language') as string) || 'auto').trim();
      const possibleAudio = formData.get('audio');
      if (possibleAudio instanceof File) {
        audioFileFromClient = possibleAudio;
      }
    }

    if (!videoId) {
      return NextResponse.json(
        { error: 'Missing videoId in analysis request' },
        { status: 400, headers: corsHeaders() }
      );
    }

    activeVideoId = videoId;

    // 3. Fetch video record from Supabase
    const { data: videoRecord, error: videoFetchError } = await adminSupabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .eq('user_id', user.id)
      .single();

    if (videoFetchError || !videoRecord) {
      return NextResponse.json(
        { error: 'Video record not found or access denied in database' },
        { status: 404, headers: corsHeaders() }
      );
    }

    // 4. Update status to processing
    await adminSupabase
      .from('videos')
      .update({ status: 'processing', error_message: null })
      .eq('id', videoId);

    // 5. Prepare audio for Groq Whisper
    let whisperFile: any = null;

    if (audioFileFromClient && audioFileFromClient.size > 0) {
      const audioBuffer = Buffer.from(await audioFileFromClient.arrayBuffer());
      const fileName = audioFileFromClient.name || 'audio.wav';
      const fileMime = audioFileFromClient.type || 'audio/wav';
      whisperFile = await toFile(audioBuffer, fileName, { type: fileMime });
    } else {
      let downloadStoragePath = videoRecord.storage_path;
      const possibleAudioPath = `${videoRecord.storage_path}.audio.wav`;

      let storageBlob: Blob | null = null;

      // Check if extracted audio exists first
      const { data: audioBlob } = await adminSupabase.storage
        .from('videos')
        .download(possibleAudioPath);

      if (audioBlob) {
        storageBlob = audioBlob;
        downloadStoragePath = possibleAudioPath;
      } else {
        const { data: videoBlob, error: downloadError } = await adminSupabase.storage
          .from('videos')
          .download(videoRecord.storage_path);

        if (downloadError || !videoBlob) {
          throw new Error(
            `Unable to retrieve video from Supabase Storage: ${downloadError?.message || 'File missing'}`
          );
        }
        storageBlob = videoBlob;
      }

      const fileBuffer = Buffer.from(await storageBlob.arrayBuffer());
      const fileName = downloadStoragePath.endsWith('.wav')
        ? 'audio.wav'
        : videoRecord.file_name || 'video.mp4';
      const fileMime = downloadStoragePath.endsWith('.wav')
        ? 'audio/wav'
        : storageBlob.type || 'video/mp4';

      whisperFile = await toFile(fileBuffer, fileName, { type: fileMime });
    }

    // Language configuration with native prompts
    const LANGUAGE_CONFIG: Record<string, { code: string; name: string; prompt: string }> = {
      te: {
        code: 'te',
        name: 'Telugu',
        prompt:
          'సమావేశం చర్చ, స్పష్టమైన విరామ చిహ్నాలు, సరైన పేర్లు మరియు సహజమైన సంభాషణ. ఖచ్చితమైన తెలుగు లిపి అనువాదం లేకుండా.',
      },
      hi: {
        code: 'hi',
        name: 'Hindi',
        prompt:
          'मीटिंग की चर्चा, स्पष्ट विराम चिह्न, सही नाम और स्वाभाविक बातचीत। बिना किसी अनुवाद के मूल हिंदी में।',
      },
      ta: {
        code: 'ta',
        name: 'Tamil',
        prompt:
          'கூட்ட உரையாடல், தெளிவான நிறுத்தற்குறிகள், துல்லியமான தமிழ் வரிகள் மொழிபெயர்ப்பு இல்லாமல்.',
      },
      kn: {
        code: 'kn',
        name: 'Kannada',
        prompt: 'ಸಭೆಯ ಚರ್ಚೆ, ಸ್ಪಷ್ಟ ವಿರಾಮಚಿಹ್ನೆಗಳು, ನಿಖರವಾದ ಕನ್ನಡ ಲಿಪಿ.',
      },
      ml: {
        code: 'ml',
        name: 'Malayalam',
        prompt: 'മീറ്റിംഗ് സംഭാഷണം, കൃത്യമായ ചിഹ്നങ്ങൾ, മലയാളത്തിൽ മാത്രം.',
      },
      mr: {
        code: 'mr',
        name: 'Marathi',
        prompt: 'मीटिंगची चर्चा, अचूक विरामचिन्हे, अस्सल मराठीमध्ये.',
      },
      bn: {
        code: 'bn',
        name: 'Bengali',
        prompt: 'মিটিংয়ের আলোচনা, সঠিক যतिচিহ্ন ও শুদ্ধ বাংলা উচ্চারণ।',
      },
      en: {
        code: 'en',
        name: 'English',
        prompt:
          'Professional meeting recording with accurate punctuation, technical terminology, proper nouns, and clear sentence structure.',
      },
      es: {
        code: 'es',
        name: 'Spanish',
        prompt:
          'Reunión profesional con puntuación precisa, términos técnicos y diálogo natural sin traducción.',
      },
      fr: {
        code: 'fr',
        name: 'French',
        prompt:
          'Réunion professionnelle avec ponctuation précise, termes techniques et dialogue naturel.',
      },
      de: {
        code: 'de',
        name: 'German',
        prompt:
          'Professionelle Besprechung mit präziser Zeichensetzung, Fachbegriffen und natürlichem Dialog.',
      },
      ja: {
        code: 'ja',
        name: 'Japanese',
        prompt:
          '正確な句読点、専門用語、自然な会話を含むビジネスミーティング。翻訳なしで日本語のまま書き起こしてください。',
      },
      ar: {
        code: 'ar',
        name: 'Arabic',
        prompt:
          'نقاش اجتماع عمل مع علامات ترقيم دقيقة ومصطلحات تقنية باللغة الأصلية بدون ترجمة.',
      },
    };

    const isSpecificLanguage =
      requestedLanguage &&
      requestedLanguage !== 'auto' &&
      Boolean(LANGUAGE_CONFIG[requestedLanguage]);

    const whisperPrompt = isSpecificLanguage
      ? LANGUAGE_CONFIG[requestedLanguage].prompt
      : 'Spoken dialogue with clear punctuation, proper nouns, and technical terms in English, Telugu, Hindi, and regional languages. Transcribe accurately without translating.';

    // 6. Transcribe with Groq Whisper
    const transcriptionOptions: any = {
      file: whisperFile,
      model: 'whisper-large-v3',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
      temperature: 0,
      prompt: whisperPrompt,
    };

    if (isSpecificLanguage) {
      transcriptionOptions.language = LANGUAGE_CONFIG[requestedLanguage].code;
    }

    const transcription = await groq.audio.transcriptions.create(transcriptionOptions);

    const rawWhisperLang = (((transcription as any).language || '') as string)
      .toLowerCase()
      .trim();
    let detectedLanguageName = isSpecificLanguage
      ? LANGUAGE_CONFIG[requestedLanguage].name
      : 'English';
    let detectedLanguageCode = isSpecificLanguage ? LANGUAGE_CONFIG[requestedLanguage].code : 'en';

    if (!isSpecificLanguage && rawWhisperLang) {
      const match = Object.entries(LANGUAGE_CONFIG).find(
        ([code, conf]) =>
          code === rawWhisperLang ||
          conf.name.toLowerCase() === rawWhisperLang ||
          rawWhisperLang.startsWith(code)
      );
      if (match) {
        detectedLanguageCode = match[1].code;
        detectedLanguageName = match[1].name;
      } else {
        detectedLanguageName = rawWhisperLang.charAt(0).toUpperCase() + rawWhisperLang.slice(1);
        detectedLanguageCode = rawWhisperLang.slice(0, 2);
      }
    }

    const rawSegments = (transcription as any).segments || [];
    const cleanedSegments: Array<{ start: number; end: number; text: string }> = [];

    for (let i = 0; i < rawSegments.length; i++) {
      const seg = rawSegments[i];
      const rawText = (seg.text || '').trim();

      if (
        !rawText ||
        /^(?:\[blank_audio\]|\[applause\]|\[music\]|\(music\)|\.{3,})$/i.test(rawText)
      ) {
        continue;
      }

      const start = Math.max(0, Number(Number(seg.start || 0).toFixed(2)));
      let end = Number(Number(seg.end || start + 2.5).toFixed(2));
      if (end <= start) {
        end = Number((start + 2.5).toFixed(2));
      }

      cleanedSegments.push({
        start,
        end,
        text: rawText,
      });
    }

    if (cleanedSegments.length === 0 && (transcription as any).text) {
      cleanedSegments.push({
        start: 0,
        end: 3,
        text: ((transcription as any).text || '').trim(),
      });
    }

    // 7. Format transcript for Groq LLM Analysis
    const fullTranscriptText = cleanedSegments
      .map((seg) => `[${formatTime(seg.start)} - ${formatTime(seg.end)}] ${seg.text}`)
      .join('\n');

    let promptTranscriptText = fullTranscriptText;
    const MAX_PROMPT_CHARS = 35000;
    if (fullTranscriptText.length > MAX_PROMPT_CHARS) {
      const lines = fullTranscriptText.split('\n');
      const step = Math.ceil(fullTranscriptText.length / MAX_PROMPT_CHARS);
      promptTranscriptText = lines.filter((_, idx) => idx % step === 0).join('\n');
    }

    const analysisPrompt = `You are an expert video/meeting analyst. Analyze the following transcript.
The transcript is in ${detectedLanguageName}.
Provide a comprehensive, executive-ready analysis in clear English.

TRANSCRIPT:
${promptTranscriptText}

Respond with ONLY a valid JSON object (no markdown, no code fences) with the following structure:
{
  "executive_summary": "A concise 2-3 sentence overview of the entire content",
  "detailed_synopsis": "A detailed paragraph-form synopsis covering all main points discussed",
  "topics": ["topic1", "topic2"],
  "important_points": ["point1", "point2"],
  "conclusions": "Summary of conclusions reached",
  "key_moments": [
    {"timestamp": 0, "title": "moment title", "description": "brief description"}
  ],
  "meeting_overview": "Overview if this appears to be a meeting or presentation, otherwise null",
  "meeting_decisions": ["decision1"],
  "action_items": [
    {"task": "task description", "assignee": "Speaker X", "deadline": "mentioned deadline or TBD", "priority": "high|medium|low"}
  ],
  "unresolved_questions": ["question1"],
  "speakers": [
    {"id": "Speaker 1", "segments": [0, 1, 2]}
  ]
}

IMPORTANT RULES:
- Identify distinct voices or dialogue cues if present
- Assign segments to speakers using segment indices starting from 0
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

    // 8. Build speaker mapping
    const speakerAssignments = analysis.speakers || [];
    const segmentSpeakerMap: Record<number, string> = {};

    speakerAssignments.forEach((speaker: { id: string; segments: number[] }) => {
      (speaker.segments || []).forEach((segIdx: number) => {
        segmentSpeakerMap[segIdx] = speaker.id;
      });
    });

    const transcriptSegments = cleanedSegments.map((seg, index: number) => ({
      id: `seg-${index}`,
      start: seg.start,
      end: seg.end,
      speaker: segmentSpeakerMap[index] || `Speaker 1`,
      text: seg.text,
    }));

    const uniqueSpeakers = [...new Set(transcriptSegments.map((s) => s.speaker))] as string[];
    const speakerMapping: Record<string, string> = {
      _detected_language: detectedLanguageName,
      _language_code: detectedLanguageCode,
    };
    uniqueSpeakers.forEach((s) => {
      speakerMapping[s] = s;
    });

    // 9. Save analysis to Supabase
    const { error: insertError } = await adminSupabase.from('video_analyses').upsert(
      {
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
      },
      { onConflict: 'video_id' }
    );

    if (insertError) {
      console.error('Database insert error:', insertError);
      throw new Error(`Failed to save video analysis: ${insertError.message}`);
    }

    // Calculate approximate duration
    const lastSegment = transcriptSegments[transcriptSegments.length - 1];
    const durationSec = lastSegment ? Math.round(lastSegment.end) : 0;

    // 10. Update video status to completed
    await adminSupabase
      .from('videos')
      .update({
        status: 'completed',
        duration: durationSec,
        error_message: null,
      })
      .eq('id', videoId);

    return NextResponse.json(
      {
        success: true,
        videoId,
        segmentCount: transcriptSegments.length,
        speakerCount: uniqueSpeakers.length,
      },
      { headers: corsHeaders() }
    );
  } catch (error) {
    console.error('Analyze route failure:', error);
    const errorMsg = error instanceof Error ? error.message : 'Video analysis failed';

    if (activeVideoId) {
      try {
        await adminSupabase
          .from('videos')
          .update({ status: 'error', error_message: errorMsg })
          .eq('id', activeVideoId);
      } catch (dbErr) {
        console.error('Failed to record error status in DB:', dbErr);
      }
    }

    return NextResponse.json(
      { error: errorMsg },
      { status: 500, headers: corsHeaders() }
    );
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
