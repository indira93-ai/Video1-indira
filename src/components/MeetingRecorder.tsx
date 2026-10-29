'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  Video,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Square,
  Play,
  Download,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Loader2,
  X,
  Minimize2,
  Maximize2,
  RotateCcw,
  Info,
  Clock,
  HardDrive,
  Globe,
} from 'lucide-react';

export const MEETING_SPOKEN_LANGUAGES = [
  { code: 'auto', name: 'Auto-Detect Spoken Language', native: 'Auto' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'en', name: 'English', native: 'English' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
];

interface MeetingRecorderProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (videoId: string) => void;
}

type RecordPhase = 'idle' | 'requesting' | 'recording' | 'stopped' | 'saving' | 'saved' | 'error';

export default function MeetingRecorder({
  isOpen,
  onClose,
  onSaved,
}: MeetingRecorderProps) {
  const router = useRouter();
  const supabase = createClient();

  const [phase, setPhase] = useState<RecordPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [hasSystemAudio, setHasSystemAudio] = useState<boolean>(true);
  const [hasMicAudio, setHasMicAudio] = useState<boolean>(true);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);

  // Audio meters (0 to 100)
  const [micLevel, setMicLevel] = useState<number>(0);
  const [sysLevel, setSysLevel] = useState<number>(0);

  // Timer
  const [secondsElapsed, setSecondsElapsed] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Streams & Nodes
  const micStreamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Recorders & Output
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const audioChunksRef = useRef<Blob[]>([]);

  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [recordedAudioBlob, setRecordedAudioBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Save state
  const [meetingTitle, setMeetingTitle] = useState<string>('');
  const [meetingLanguage, setMeetingLanguage] = useState<string>('auto');
  const [saveProgress, setSaveProgress] = useState<number>(0);
  const [saveStepText, setSaveStepText] = useState<string>('');
  const [savedVideoId, setSavedVideoId] = useState<string | null>(null);

  // Live video preview ref (during recording)
  const livePreviewRef = useRef<HTMLVideoElement | null>(null);

  // Format seconds to HH:MM:SS or MM:SS
  const formatDuration = (totalSeconds: number): string => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins
        .toString()
        .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Clean up streams & audio nodes
  const cleanupStreams = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((t) => t.stop());
      displayStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setMicLevel(0);
    setSysLevel(0);
  };

  // Stop Recording
  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    const mr = mediaRecorderRef.current;
    const ar = audioRecorderRef.current;

    const finalizeBlobs = () => {
      const videoMime = mr?.mimeType || 'video/webm';
      const vBlob = new Blob(recordedChunksRef.current, { type: videoMime });
      setRecordedVideoBlob(vBlob);

      const aBlob =
        audioChunksRef.current.length > 0
          ? new Blob(audioChunksRef.current, { type: ar?.mimeType || 'audio/webm' })
          : null;
      setRecordedAudioBlob(aBlob);

      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      const url = URL.createObjectURL(vBlob);
      previewUrlRef.current = url;
      setPreviewUrl(url);

      cleanupStreams();
      setPhase('stopped');
      setIsMinimized(false);
    };

    if (mr && mr.state === 'recording') {
      mr.onstop = () => {
        if (ar && ar.state === 'recording') {
          ar.onstop = () => finalizeBlobs();
          ar.stop();
        } else {
          finalizeBlobs();
        }
      };
      mr.stop();
    } else {
      finalizeBlobs();
    }
  };

  // Start Meeting Recording
  const startRecording = async () => {
    try {
      setErrorMessage('');
      setPhase('requesting');
      setSecondsElapsed(0);
      recordedChunksRef.current = [];
      audioChunksRef.current = [];
      setRecordedVideoBlob(null);
      setRecordedAudioBlob(null);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
        setPreviewUrl(null);
      }

      // Check browser support
      if (typeof window === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
        throw new Error(
          'Screen and system audio capture is not supported by your browser. Please use Google Chrome, Microsoft Edge, or Firefox on desktop.'
        );
      }

      // 1. Request microphone voice stream
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        micStreamRef.current = micStream;
        setHasMicAudio(true);
      } catch (micErr) {
        console.warn('Microphone permission not granted or unavailable:', micErr);
        setHasMicAudio(false);
      }

      // 2. Request system audio & meeting screen stream
      // Chrome supports 'systemAudio: include' to hint system audio checkbox
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
          frameRate: { ideal: 30, max: 60 },
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          // Chromium hints
          systemAudio: 'include',
          selfBrowserSurface: 'exclude',
        } as MediaTrackConstraints,
      });
      displayStreamRef.current = displayStream;

      const sysAudioTracks = displayStream.getAudioTracks();
      const hasSysAudio = sysAudioTracks.length > 0;
      setHasSystemAudio(hasSysAudio);

      // Listen for user clicking the browser's native "Stop sharing" button
      const videoTrack = displayStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          stopRecording();
        });
      }

      // 3. Set up Web Audio API to merge Microphone voice and Computer System audio
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const destination = audioCtx.createMediaStreamDestination();

      // Connect Microphone
      let micAnalyser: AnalyserNode | null = null;
      if (micStream && micStream.getAudioTracks().length > 0) {
        const micSource = audioCtx.createMediaStreamSource(micStream);
        const micGain = audioCtx.createGain();
        micGain.gain.value = 1.0;
        micAnalyser = audioCtx.createAnalyser();
        micAnalyser.fftSize = 64;

        micSource.connect(micGain);
        micGain.connect(micAnalyser);
        micGain.connect(destination);
      }

      // Connect System Audio
      let sysAnalyser: AnalyserNode | null = null;
      if (hasSysAudio) {
        const sysStream = new MediaStream([sysAudioTracks[0]]);
        const sysSource = audioCtx.createMediaStreamSource(sysStream);
        const sysGain = audioCtx.createGain();
        sysGain.gain.value = 1.0;
        sysAnalyser = audioCtx.createAnalyser();
        sysAnalyser.fftSize = 64;

        sysSource.connect(sysGain);
        sysGain.connect(sysAnalyser);
        sysGain.connect(destination);
      }

      // Audio volume visualizer loop
      const updateAudioMeters = () => {
        if (micAnalyser) {
          const micData = new Uint8Array(micAnalyser.frequencyBinCount);
          micAnalyser.getByteFrequencyData(micData);
          const micSum = micData.reduce((acc, val) => acc + val, 0);
          const micAvg = micSum / micData.length;
          setMicLevel(Math.min(100, Math.round((micAvg / 128) * 100)));
        }
        if (sysAnalyser) {
          const sysData = new Uint8Array(sysAnalyser.frequencyBinCount);
          sysAnalyser.getByteFrequencyData(sysData);
          const sysSum = sysData.reduce((acc, val) => acc + val, 0);
          const sysAvg = sysSum / sysData.length;
          setSysLevel(Math.min(100, Math.round((sysAvg / 128) * 100)));
        }
        animFrameRef.current = requestAnimationFrame(updateAudioMeters);
      };
      updateAudioMeters();

      // 4. Build combined stream for Video + Mixed Audio
      const combinedTracks: MediaStreamTrack[] = [];
      if (videoTrack) combinedTracks.push(videoTrack);

      const mixedAudioTracks = destination.stream.getAudioTracks();
      if (mixedAudioTracks.length > 0) {
        combinedTracks.push(mixedAudioTracks[0]);
      } else if (micStream && micStream.getAudioTracks().length > 0) {
        combinedTracks.push(micStream.getAudioTracks()[0]);
      }

      const combinedStream = new MediaStream(combinedTracks);

      // Attach live preview
      if (livePreviewRef.current) {
        livePreviewRef.current.srcObject = combinedStream;
        livePreviewRef.current.play().catch(() => {});
      }

      // 5. Initialize MediaRecorder for Video (VP9/VP8/Opus)
      const preferredMimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4',
      ];
      let selectedMimeType = '';
      for (const mime of preferredMimeTypes) {
        if (MediaRecorder.isTypeSupported(mime)) {
          selectedMimeType = mime;
          break;
        }
      }

      const recorderOptions = selectedMimeType ? { mimeType: selectedMimeType } : undefined;
      const mediaRecorder = new MediaRecorder(combinedStream, recorderOptions);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      // 6. Also initialize a lightweight simultaneous Audio Recorder
      try {
        const audioMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
        if (destination.stream.getAudioTracks().length > 0) {
          const audioRecorder = new MediaRecorder(
            destination.stream,
            audioMime ? { mimeType: audioMime } : undefined
          );
          audioRecorderRef.current = audioRecorder;
          audioRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              audioChunksRef.current.push(e.data);
            }
          };
          audioRecorder.start(1000);
        }
      } catch (err) {
        console.warn('Audio-only stream recorder initialization skipped:', err);
      }

      // Start recording with 1-second timeslices
      mediaRecorder.start(1000);
      setPhase('recording');

      // Start duration timer
      timerRef.current = setInterval(() => {
        setSecondsElapsed((prev) => prev + 1);
      }, 1000);

      // Default meeting title with date
      const dateStr = new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      setMeetingTitle(`Meeting Recording - ${dateStr}`);
    } catch (err) {
      console.error('Failed to start meeting recording:', err);
      cleanupStreams();
      setPhase('error');
      const errStr = err instanceof Error ? err.message : 'Permission denied or capture failed.';
      if (errStr.includes('Permission denied') || errStr.includes('NotAllowedError')) {
        setErrorMessage(
          'Screen/system audio or microphone permission was cancelled. Please click Start Recording again and allow permissions.'
        );
      } else {
        setErrorMessage(errStr);
      }
    }
  };

  // Discard & Reset
  const handleDiscard = () => {
    cleanupStreams();
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      setPreviewUrl(null);
    }
    setRecordedVideoBlob(null);
    setRecordedAudioBlob(null);
    setPhase('idle');
    setSecondsElapsed(0);
    setErrorMessage('');
  };

  // Download Recording directly
  const handleDownload = () => {
    if (!recordedVideoBlob) return;
    const safeTitle = (meetingTitle.trim() || 'meeting-recording').replace(/[^a-zA-Z0-9_-]/g, '_');
    const ext = recordedVideoBlob.type.includes('mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(recordedVideoBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeTitle}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Save to Supabase and Trigger AI Analysis
  const handleSaveAndAnalyze = async () => {
    if (!recordedVideoBlob) return;
    setPhase('saving');
    setSaveProgress(5);
    setSaveStepText('Preparing video recording...');

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Please sign in to save and analyze recordings.');

      setSaveProgress(15);
      setSaveStepText('Uploading meeting recording to secure storage...');

      const isMp4 = recordedVideoBlob.type.includes('mp4');
      const fileExt = isMp4 ? 'mp4' : 'webm';
      const fileName = `meeting-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const storagePath = `${user.id}/${fileName}`;

      const videoFile = new File([recordedVideoBlob], fileName, {
        type: recordedVideoBlob.type || 'video/webm',
      });

      // Upload to Supabase Storage with progress simulation
      const progressTimer = setInterval(() => {
        setSaveProgress((prev) => Math.min(prev + 5, 80));
      }, 400);

      const { error: storageError } = await supabase.storage
        .from('videos')
        .upload(storagePath, videoFile, {
          cacheControl: '3600',
          upsert: false,
        });

      clearInterval(progressTimer);

      if (storageError) throw storageError;

      setSaveProgress(85);
      setSaveStepText('Creating video record & preparing AI analysis...');

      // Create video database record
      const finalTitle = meetingTitle.trim() || `Meeting Recording - ${formatDuration(secondsElapsed)}`;
      const { data: videoRecord, error: dbError } = await supabase
        .from('videos')
        .insert({
          user_id: user.id,
          title: finalTitle,
          file_name: fileName,
          file_size: videoFile.size,
          duration: secondsElapsed,
          storage_path: storagePath,
          status: 'processing',
        })
        .select()
        .single();

      if (dbError || !videoRecord) {
        throw dbError || new Error('Failed to create video record in database.');
      }

      setSavedVideoId(videoRecord.id);
      setSaveProgress(90);
      setSaveStepText('Transcribing audio & generating AI synopsis...');

      // Prepare audio for Groq Whisper
      let audioBlobToSend: Blob = recordedAudioBlob || recordedVideoBlob;
      let audioFileName = 'meeting-audio.webm';

      if (!recordedAudioBlob && recordedVideoBlob.size > 20 * 1024 * 1024) {
        try {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const aCtx = new AudioCtx({ sampleRate: 16000 });
          const ab = await recordedVideoBlob.arrayBuffer();
          const audioBuffer = await aCtx.decodeAudioData(ab);
          audioBlobToSend = encodeAudioBufferToWav(audioBuffer);
          audioFileName = 'meeting-audio.wav';
          await aCtx.close();

          // Upload audio to Supabase Storage
          await supabase.storage
            .from('videos')
            .upload(`${storagePath}.audio.wav`, audioBlobToSend, {
              cacheControl: '3600',
              upsert: true,
            });
        } catch (e) {
          console.warn('WAV fallback encode skipped:', e);
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const authHeaders: Record<string, string> = {};
      if (session?.access_token) {
        authHeaders['Authorization'] = `Bearer ${session.access_token}`;
      }

      let response: Response;
      if (audioBlobToSend && audioBlobToSend.size <= 3.5 * 1024 * 1024) {
        const formData = new FormData();
        formData.append('audio', audioBlobToSend, audioFileName);
        formData.append('videoId', videoRecord.id);
        formData.append('language', meetingLanguage);

        response = await fetch('/api/analyze', {
          method: 'POST',
          headers: authHeaders,
          body: formData,
        });
      } else {
        response = await fetch('/api/analyze', {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            videoId: videoRecord.id,
            language: meetingLanguage,
          }),
        });
      }

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(
          errJson.error || `AI Analysis failed with server code ${response.status}`
        );
      }

      setSaveProgress(100);
      setSaveStepText('Analysis complete!');
      setPhase('saved');

      if (onSaved) {
        onSaved(videoRecord.id);
      }

      setTimeout(() => {
        router.push(`/video/${videoRecord.id}`);
      }, 800);
    } catch (err) {
      console.error('Save & Analyze error:', err);
      setPhase('error');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save and analyze recording.');
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      cleanupStreams();
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  // Floating Minimized Bar when recording
  if (phase === 'recording' && isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-surface-900/95 backdrop-blur-xl border border-rose-500/50 p-3 rounded-2xl shadow-2xl shadow-rose-950/50 slide-up">
        <div className="flex items-center gap-2 pl-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
          </span>
          <span className="text-sm font-mono font-bold text-rose-300">
            {formatDuration(secondsElapsed)}
          </span>
        </div>

        {/* Audio dots */}
        <div className="flex items-center gap-2 px-2 border-l border-surface-700">
          <div title={`Microphone Voice: ${micLevel}%`} className="flex items-center gap-1">
            <Mic className={`w-3.5 h-3.5 ${micLevel > 5 ? 'text-emerald-400' : 'text-surface-500'}`} />
            <div className="w-8 h-1.5 bg-surface-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-100"
                style={{ width: `${micLevel}%` }}
              />
            </div>
          </div>
          <div title={`System Audio: ${sysLevel}%`} className="flex items-center gap-1">
            <Volume2 className={`w-3.5 h-3.5 ${sysLevel > 5 ? 'text-cyan-400' : 'text-surface-500'}`} />
            <div className="w-8 h-1.5 bg-surface-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-500 transition-all duration-100"
                style={{ width: `${sysLevel}%` }}
              />
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 pl-1">
          <button
            onClick={stopRecording}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
          >
            <Square className="w-3 h-3 fill-current" />
            Stop
          </button>
          <button
            onClick={() => setIsMinimized(false)}
            className="p-1.5 text-surface-400 hover:text-surface-200 transition-colors"
            title="Expand recorder window"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-md">
      <div className="glass-card w-full max-w-2xl overflow-hidden slide-up border border-surface-700/60 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-800/80 bg-surface-900/60">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                phase === 'recording'
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  : 'bg-primary-500/10 text-primary-400 border border-primary-500/20'
              }`}
            >
              <Video className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-surface-100 flex items-center gap-2">
                One-Click Meeting Recording
                {phase === 'recording' && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                    REC
                  </span>
                )}
              </h2>
              <p className="text-xs text-surface-400">
                Captures microphone voice + computer system audio in real-time
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {phase === 'recording' && (
              <button
                onClick={() => setIsMinimized(true)}
                className="btn-ghost p-2 text-surface-400 hover:text-surface-200"
                title="Minimize recorder during meeting"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => {
                if (phase === 'recording') {
                  if (confirm('A recording is in progress. Stop and discard it?')) {
                    cleanupStreams();
                    onClose();
                  }
                } else {
                  cleanupStreams();
                  onClose();
                }
              }}
              className="btn-ghost p-2 text-surface-400 hover:text-surface-200"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6">
          {/* Phase 1: Idle / Start Screen */}
          {phase === 'idle' && (
            <div className="space-y-6 text-center py-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500/20 to-primary-500/20 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto shadow-inner">
                <Video className="w-8 h-8" />
              </div>

              <div className="max-w-md mx-auto">
                <h3 className="text-xl font-bold text-surface-100 mb-2">
                  Record Zoom, Google Meet & Teams
                </h3>
                <p className="text-sm text-surface-400 leading-relaxed">
                  Click <strong className="text-surface-200">Start Recording</strong> to automatically enable your microphone and computer system audio. Both audio tracks are combined seamlessly.
                </p>
              </div>

              {/* Audio features showcase */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto text-left">
                <div className="p-3.5 rounded-xl bg-surface-900/60 border border-surface-800 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Mic className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-surface-200">Microphone Voice</h4>
                    <p className="text-xs text-surface-500 mt-0.5">
                      Your voice with noise suppression and echo cancellation
                    </p>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-900/60 border border-surface-800 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Volume2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-surface-200">System Audio</h4>
                    <p className="text-xs text-surface-500 mt-0.5">
                      Other meeting attendees, video calls & computer sound
                    </p>
                  </div>
                </div>
              </div>

              {/* Spoken Language Selector (Pre-recording) */}
              <div className="max-w-lg mx-auto p-3 rounded-xl bg-surface-900/60 border border-surface-800 text-left">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-primary-400 flex-shrink-0" />
                    <div>
                      <h4 className="text-xs font-semibold text-surface-200">
                        Meeting Spoken Language
                      </h4>
                      <p className="text-[11px] text-surface-400">
                        Select spoken language for 100% accurate CC subtitles (Telugu, Hindi, English, etc.)
                      </p>
                    </div>
                  </div>
                  <select
                    value={meetingLanguage}
                    onChange={(e) => setMeetingLanguage(e.target.value)}
                    className="bg-surface-800 border border-surface-700 text-xs font-medium text-surface-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary-500 cursor-pointer"
                  >
                    {MEETING_SPOKEN_LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name} {lang.native !== 'Auto' ? `(${lang.native})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Browser sharing tip */}
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-surface-900/40 border border-surface-800/80 max-w-lg mx-auto text-left text-xs text-surface-400">
                <Info className="w-4 h-4 text-primary-400 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Tip for Best System Audio:</strong> In the browser prompt, select your meeting tab or Entire Screen and make sure <span className="text-primary-300">&quot;Share system audio&quot;</span> is checked.
                </span>
              </div>

              <div className="pt-2">
                <button
                  onClick={startRecording}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-gradient-to-r from-rose-600 via-red-600 to-rose-700 hover:from-rose-500 hover:to-red-500 text-white font-semibold rounded-xl shadow-lg shadow-rose-600/30 hover:scale-[1.02] active:scale-[0.98] transition-all text-base cursor-pointer"
                >
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-200 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
                  </span>
                  Start Recording
                </button>
              </div>
            </div>
          )}

          {/* Phase 2: Requesting Permissions */}
          {phase === 'requesting' && (
            <div className="text-center py-12 space-y-4">
              <Loader2 className="w-12 h-12 text-rose-500 animate-spin mx-auto" />
              <h3 className="text-lg font-bold text-surface-100">
                Requesting Browser Permissions...
              </h3>
              <p className="text-sm text-surface-400 max-w-sm mx-auto">
                Please allow microphone access and choose your meeting tab or screen to share with audio.
              </p>
            </div>
          )}

          {/* Phase 3: Active Recording */}
          {phase === 'recording' && (
            <div className="space-y-5">
              {/* Live Preview Display */}
              <div className="relative rounded-2xl overflow-hidden bg-black aspect-video border border-surface-800 shadow-inner flex items-center justify-center">
                <video
                  ref={livePreviewRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-contain"
                />

                {/* Overlaid duration badge */}
                <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/75 backdrop-blur-md border border-white/10 text-white font-mono text-sm font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
                  {formatDuration(secondsElapsed)}
                </div>

                {/* Overlaid system audio warning if missing */}
                {!hasSystemAudio && (
                  <div className="absolute bottom-3 left-3 right-3 p-2.5 rounded-xl bg-amber-500/20 backdrop-blur-md border border-amber-500/40 text-amber-200 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-300" />
                    <span>
                      System audio wasn&apos;t shared in the prompt. Recording with microphone only.
                    </span>
                  </div>
                )}
              </div>

              {/* Real-time Dual Audio Visualizers */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-surface-900/70 border border-surface-800">
                {/* Microphone Level */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="flex items-center gap-1.5 text-surface-300">
                      {hasMicAudio ? (
                        <Mic className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <MicOff className="w-4 h-4 text-red-400" />
                      )}
                      Microphone Voice
                    </span>
                    <span className={`text-[11px] font-mono ${micLevel > 5 ? 'text-emerald-400 font-bold' : 'text-surface-500'}`}>
                      {hasMicAudio ? `${micLevel}%` : 'Muted/Denied'}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-surface-800 rounded-full overflow-hidden p-0.5">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-75"
                      style={{ width: `${micLevel}%` }}
                    />
                  </div>
                </div>

                {/* System Audio Level */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="flex items-center gap-1.5 text-surface-300">
                      {hasSystemAudio ? (
                        <Volume2 className="w-4 h-4 text-cyan-400" />
                      ) : (
                        <VolumeX className="w-4 h-4 text-amber-400" />
                      )}
                      Computer System Audio
                    </span>
                    <span className={`text-[11px] font-mono ${sysLevel > 5 ? 'text-cyan-400 font-bold' : 'text-surface-500'}`}>
                      {hasSystemAudio ? `${sysLevel}%` : 'Not Shared'}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-surface-800 rounded-full overflow-hidden p-0.5">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-75"
                      style={{ width: `${sysLevel}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setIsMinimized(true)}
                  className="btn-secondary text-xs flex items-center gap-1.5"
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                  Minimize to Floating Widget
                </button>

                <button
                  type="button"
                  onClick={stopRecording}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-semibold rounded-xl shadow-lg shadow-rose-600/30 transition-all text-sm group cursor-pointer"
                >
                  <Square className="w-4 h-4 fill-current group-hover:scale-95 transition-transform" />
                  Stop Recording
                </button>
              </div>
            </div>
          )}

          {/* Phase 4: Stopped / Review & Save */}
          {phase === 'stopped' && (
            <div className="space-y-5">
              {/* Video Player Preview */}
              <div className="relative rounded-2xl overflow-hidden bg-black aspect-video border border-surface-800 shadow-inner">
                {previewUrl && (
                  <video
                    src={previewUrl}
                    controls
                    className="w-full h-full object-contain"
                  />
                )}
              </div>

              {/* Meeting Title & Metadata */}
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-surface-300 mb-1">
                      Meeting Title
                    </label>
                    <input
                      type="text"
                      value={meetingTitle}
                      onChange={(e) => setMeetingTitle(e.target.value)}
                      placeholder="e.g. Q3 Sprint Planning Meeting"
                      className="input-field text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-surface-300 mb-1">
                      Spoken Language for Subtitles
                    </label>
                    <select
                      value={meetingLanguage}
                      onChange={(e) => setMeetingLanguage(e.target.value)}
                      className="input-field text-sm cursor-pointer"
                    >
                      {MEETING_SPOKEN_LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.name} {lang.native !== 'Auto' ? `(${lang.native})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-surface-400 px-1">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-primary-400" />
                      Duration: <strong className="text-surface-200">{formatDuration(secondsElapsed)}</strong>
                    </span>
                    {recordedVideoBlob && (
                      <span className="flex items-center gap-1">
                        <HardDrive className="w-3.5 h-3.5 text-primary-400" />
                        Size: <strong className="text-surface-200">{formatFileSize(recordedVideoBlob.size)}</strong>
                      </span>
                    )}
                  </div>
                  <span className="badge-success">Ready to save</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={handleDownload}
                  className="btn-secondary w-full sm:w-auto flex-1 text-sm flex items-center justify-center gap-2"
                  title="Save video file directly to your computer"
                >
                  <Download className="w-4 h-4" />
                  Download Video
                </button>

                <button
                  type="button"
                  onClick={handleSaveAndAnalyze}
                  className="btn-primary w-full sm:w-auto flex-1 text-sm flex items-center justify-center gap-2 shadow-lg shadow-primary-500/25"
                >
                  <Sparkles className="w-4 h-4" />
                  Save & Analyze with AI
                </button>

                <button
                  type="button"
                  onClick={handleDiscard}
                  className="btn-ghost text-xs text-surface-400 hover:text-surface-200"
                  title="Discard this recording and start over"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* Phase 5: Saving & Analyzing */}
          {phase === 'saving' && (
            <div className="text-center py-10 space-y-6">
              <div className="relative w-24 h-24 mx-auto">
                <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                  <circle
                    className="text-surface-800"
                    strokeWidth="6"
                    stroke="currentColor"
                    fill="transparent"
                    r="44"
                    cx="50"
                    cy="50"
                  />
                  <circle
                    className="text-primary-500 transition-all duration-300"
                    strokeWidth="6"
                    strokeDasharray={276.46}
                    strokeDashoffset={276.46 - (276.46 * saveProgress) / 100}
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="transparent"
                    r="44"
                    cx="50"
                    cy="50"
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-lg font-bold">
                  {Math.round(saveProgress)}%
                </span>
              </div>

              <div>
                <h3 className="text-lg font-bold text-surface-100 mb-1">
                  Processing Meeting Recording
                </h3>
                <p className="text-sm text-surface-400">
                  {saveStepText || 'Saving recording and starting AI analysis...'}
                </p>
              </div>

              <div className="flex items-center justify-center gap-2 text-xs text-surface-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary-400" />
                Works locally and on Vercel
              </div>
            </div>
          )}

          {/* Phase 6: Saved Complete */}
          {phase === 'saved' && (
            <div className="text-center py-10 space-y-4">
              <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto" />
              <h3 className="text-xl font-bold text-surface-100">
                Meeting Recording Saved & Analyzed!
              </h3>
              <p className="text-sm text-surface-400 max-w-sm mx-auto">
                Opening your AI transcript, summary, speakers, and video workspace...
              </p>
              {savedVideoId && (
                <button
                  onClick={() => router.push(`/video/${savedVideoId}`)}
                  className="btn-primary text-sm mt-4 inline-flex items-center gap-2"
                >
                  <Play className="w-4 h-4" />
                  View Analysis Now
                </button>
              )}
            </div>
          )}

          {/* Phase 7: Error */}
          {phase === 'error' && (
            <div className="text-center py-8 space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mx-auto">
                <AlertCircle className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-bold text-surface-100">
                Meeting Recording Notice
              </h3>
              <p className="text-sm text-red-300 max-w-md mx-auto leading-relaxed bg-red-500/10 border border-red-500/20 p-3 rounded-xl">
                {errorMessage || 'An error occurred during recording.'}
              </p>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPhase('idle')}
                  className="btn-secondary text-sm"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={startRecording}
                  className="btn-primary text-sm inline-flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Try Again
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Fallback WAV encoder in case audio recorder needs fallback
function encodeAudioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = 1;
  const sampleRate = buffer.sampleRate;
  const channelData = buffer.getChannelData(0);
  const length = channelData.length;

  const bufferArray = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bufferArray);

  function writeString(offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); // 16-bit
  writeString(36, 'data');
  view.setUint32(40, length * 2, true);

  let offset = 44;
  for (let i = 0; i < length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}
