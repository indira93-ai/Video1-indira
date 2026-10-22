'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { VideoRecord, Profile } from '@/lib/types';
import {
  Sparkles,
  Upload,
  LogOut,
  Video,
  Clock,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  FileVideo,
  Search,
  X,
  CloudUpload,
} from 'lucide-react';

const ACCEPTED_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'];
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return (
        <span className="badge-success">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Ready
        </span>
      );
    case 'processing':
      return (
        <span className="badge-processing">
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          Processing
        </span>
      );
    case 'uploading':
      return (
        <span className="badge-info">
          <CloudUpload className="w-3 h-3 mr-1" />
          Uploading
        </span>
      );
    case 'error':
      return (
        <span className="badge-error">
          <AlertCircle className="w-3 h-3 mr-1" />
          Error
        </span>
      );
    default:
      return <span className="badge-warning">{status}</span>;
  }
}

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Upload state
  const [showUpload, setShowUpload] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'extracting' | 'analyzing' | 'done' | 'error'>('idle');
  const [uploadError, setUploadError] = useState('');

  const fetchVideos = useCallback(async () => {
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) {
      setVideos(data);
    }
  }, [supabase]);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      setProfile(profileData);
      await fetchVideos();
      setIsLoading(false);
    };
    init();
  }, [router, supabase, fetchVideos]);

  // Poll for processing videos
  useEffect(() => {
    const processingVideos = videos.filter((v) => v.status === 'processing' || v.status === 'uploading');
    if (processingVideos.length === 0) return;
    const interval = setInterval(fetchVideos, 5000);
    return () => clearInterval(interval);
  }, [videos, fetchVideos]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const handleFileSelect = (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setUploadError('Unsupported format. Use MP4, WebM, MOV, or MKV.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setUploadError('File too large. Maximum size is 5GB.');
      return;
    }
    setUploadFile(file);
    setUploadError('');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploadStatus('uploading');
    setUploadProgress(0);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const fileExt = uploadFile.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const storagePath = `${user.id}/${fileName}`;

      // Upload to Supabase Storage with progress simulation
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + Math.random() * 10, 85));
      }, 500);

      const { error: storageError } = await supabase.storage
        .from('videos')
        .upload(storagePath, uploadFile, {
          cacheControl: '3600',
          upsert: false,
        });

      clearInterval(progressInterval);

      if (storageError) throw storageError;

      setUploadProgress(90);

      // Create video record
      const { data: videoRecord, error: dbError } = await supabase
        .from('videos')
        .insert({
          user_id: user.id,
          title: uploadFile.name.replace(/\.[^/.]+$/, ''),
          file_name: uploadFile.name,
          file_size: uploadFile.size,
          storage_path: storagePath,
          status: 'processing',
        })
        .select()
        .single();

      if (dbError || !videoRecord) throw dbError || new Error('Failed to create record');

      setUploadProgress(95);
      setUploadStatus('extracting');

      // Extract audio from video in browser
      const audioBlob = await extractAudioFromVideo(uploadFile);

      setUploadStatus('analyzing');

      // Send audio to API for transcription & analysis
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');
      formData.append('videoId', videoRecord.id);

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Analysis failed');
      }

      setUploadProgress(100);
      setUploadStatus('done');
      await fetchVideos();

      // Reset after brief celebration
      setTimeout(() => {
        setShowUpload(false);
        setUploadFile(null);
        setUploadStatus('idle');
        setUploadProgress(0);
      }, 1500);
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus('error');
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    }
  };

  const handleDelete = async (videoId: string) => {
    if (!confirm('Are you sure you want to delete this video and its analysis?')) return;

    const video = videos.find((v) => v.id === videoId);
    if (video) {
      await supabase.storage.from('videos').remove([video.storage_path]);
    }
    await supabase.from('videos').delete().eq('id', videoId);
    await fetchVideos();
  };

  const filteredVideos = videos.filter((v) =>
    v.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.file_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-surface-400">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Top Nav */}
      <header className="sticky top-0 z-40 bg-surface-950/80 backdrop-blur-xl border-b border-surface-800/50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold gradient-text hidden sm:inline">VideoSynopsis AI</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                setShowUpload(true);
                setUploadFile(null);
                setUploadStatus('idle');
                setUploadError('');
              }}
              className="btn-primary text-sm"
            >
              <Upload className="w-4 h-4" />
              Upload Video
            </button>
            <div className="flex items-center gap-3">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={profile.full_name}
                  className="w-8 h-8 rounded-full border-2 border-surface-700"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white text-sm font-semibold">
                  {profile?.full_name?.charAt(0) || 'U'}
                </div>
              )}
              <span className="text-sm text-surface-300 hidden md:inline">{profile?.full_name || profile?.email}</span>
            </div>
            <button onClick={handleSignOut} className="btn-ghost text-surface-400" title="Sign out">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="glass-card p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-500/10 flex items-center justify-center text-primary-400">
                <Video className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{videos.length}</p>
                <p className="text-surface-500 text-sm">Total Videos</p>
              </div>
            </div>
          </div>
          <div className="glass-card p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{videos.filter((v) => v.status === 'completed').length}</p>
                <p className="text-surface-500 text-sm">Analyzed</p>
              </div>
            </div>
          </div>
          <div className="glass-card p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent-500/10 flex items-center justify-center text-accent-400">
                <Loader2 className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{videos.filter((v) => v.status === 'processing').length}</p>
                <p className="text-surface-500 text-sm">Processing</p>
              </div>
            </div>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
            <input
              type="text"
              placeholder="Search videos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field pl-10"
            />
          </div>
          <p className="text-surface-500 text-sm">
            {filteredVideos.length} video{filteredVideos.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Video List */}
        {filteredVideos.length === 0 ? (
          <div className="glass-card p-16 text-center">
            <FileVideo className="w-16 h-16 text-surface-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">
              {videos.length === 0 ? 'No videos yet' : 'No matching videos'}
            </h3>
            <p className="text-surface-500 mb-6">
              {videos.length === 0
                ? 'Upload your first video to get started with AI analysis'
                : 'Try a different search term'}
            </p>
            {videos.length === 0 && (
              <button
                onClick={() => setShowUpload(true)}
                className="btn-primary"
              >
                <Upload className="w-4 h-4" />
                Upload Your First Video
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredVideos.map((video) => (
              <div
                key={video.id}
                className="glass-card-hover p-5 flex flex-col sm:flex-row sm:items-center gap-4 cursor-pointer"
                onClick={() => {
                  if (video.status === 'completed') {
                    router.push(`/video/${video.id}`);
                  }
                }}
              >
                <div className="w-12 h-12 rounded-xl bg-surface-700/50 flex items-center justify-center text-surface-400 flex-shrink-0">
                  <FileVideo className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-surface-100 truncate">{video.title}</h3>
                  <div className="flex items-center gap-4 mt-1 text-sm text-surface-500">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(video.created_at)}
                    </span>
                    <span>{formatFileSize(video.file_size)}</span>
                  </div>
                  {video.error_message && (
                    <p className="text-red-400 text-sm mt-1">{video.error_message}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={video.status} />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(video.id);
                    }}
                    className="btn-ghost text-surface-500 hover:text-red-400 p-2"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-8 w-full max-w-lg slide-up">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">Upload Video</h2>
              <button
                onClick={() => {
                  if (uploadStatus !== 'uploading' && uploadStatus !== 'extracting' && uploadStatus !== 'analyzing') {
                    setShowUpload(false);
                  }
                }}
                className="btn-ghost p-2"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {uploadStatus === 'idle' && (
              <>
                {/* Drop Zone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all duration-300 ${
                    isDragging
                      ? 'border-primary-500 bg-primary-500/10'
                      : uploadFile
                      ? 'border-emerald-500/50 bg-emerald-500/5'
                      : 'border-surface-600/50 hover:border-surface-500'
                  }`}
                >
                  {uploadFile ? (
                    <div>
                      <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
                      <p className="font-semibold text-surface-200">{uploadFile.name}</p>
                      <p className="text-surface-500 text-sm mt-1">{formatFileSize(uploadFile.size)}</p>
                      <button
                        onClick={() => setUploadFile(null)}
                        className="text-primary-400 text-sm mt-3 hover:underline"
                      >
                        Choose different file
                      </button>
                    </div>
                  ) : (
                    <div>
                      <CloudUpload className="w-10 h-10 text-surface-500 mx-auto mb-3" />
                      <p className="text-surface-300 font-medium mb-1">
                        Drag & drop your video here
                      </p>
                      <p className="text-surface-500 text-sm mb-4">or</p>
                      <label className="btn-secondary cursor-pointer text-sm">
                        Browse Files
                        <input
                          type="file"
                          accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileSelect(file);
                          }}
                        />
                      </label>
                      <p className="text-surface-600 text-xs mt-4">
                        MP4, WebM, MOV, MKV — up to 5GB
                      </p>
                    </div>
                  )}
                </div>

                {uploadError && (
                  <div className="flex items-center gap-2 text-red-400 text-sm mt-4">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {uploadError}
                  </div>
                )}

                <button
                  onClick={handleUpload}
                  disabled={!uploadFile}
                  className="btn-primary w-full mt-6"
                >
                  <Upload className="w-4 h-4" />
                  Upload & Analyze
                </button>
              </>
            )}

            {(uploadStatus === 'uploading' || uploadStatus === 'extracting' || uploadStatus === 'analyzing') && (
              <div className="text-center py-6">
                <div className="relative w-24 h-24 mx-auto mb-6">
                  <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                    <circle
                      className="text-surface-700"
                      strokeWidth="6"
                      stroke="currentColor"
                      fill="transparent"
                      r="44"
                      cx="50"
                      cy="50"
                    />
                    <circle
                      className="text-primary-500 transition-all duration-500"
                      strokeWidth="6"
                      strokeDasharray={276.46}
                      strokeDashoffset={276.46 - (276.46 * uploadProgress) / 100}
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="transparent"
                      r="44"
                      cx="50"
                      cy="50"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-lg font-bold">
                    {Math.round(uploadProgress)}%
                  </span>
                </div>
                <p className="font-semibold text-surface-200 mb-1">
                  {uploadStatus === 'uploading' && 'Uploading video...'}
                  {uploadStatus === 'extracting' && 'Extracting audio...'}
                  {uploadStatus === 'analyzing' && 'AI is analyzing your video...'}
                </p>
                <p className="text-surface-500 text-sm">
                  {uploadStatus === 'uploading' && 'Securely uploading to cloud storage'}
                  {uploadStatus === 'extracting' && 'Preparing audio for transcription'}
                  {uploadStatus === 'analyzing' && 'Transcribing, identifying speakers & generating insights'}
                </p>
              </div>
            )}

            {uploadStatus === 'done' && (
              <div className="text-center py-6">
                <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
                <h3 className="text-xl font-bold mb-2">Analysis Complete!</h3>
                <p className="text-surface-400">Your video has been processed successfully.</p>
              </div>
            )}

            {uploadStatus === 'error' && (
              <div className="text-center py-6">
                <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
                <h3 className="text-xl font-bold mb-2">Upload Failed</h3>
                <p className="text-surface-400 mb-6">{uploadError}</p>
                <button
                  onClick={() => {
                    setUploadStatus('idle');
                    setUploadProgress(0);
                  }}
                  className="btn-secondary"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Extract audio from video using the browser's Web Audio API
 * Returns a WebM audio blob suitable for Groq Whisper
 */
async function extractAudioFromVideo(videoFile: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;

    const url = URL.createObjectURL(videoFile);
    video.src = url;

    video.onloadedmetadata = async () => {
      try {
        // Create audio context and media element source
        const audioContext = new AudioContext();
        const source = audioContext.createMediaElementSource(video);
        const destination = audioContext.createMediaStreamDestination();
        source.connect(destination);

        // Use MediaRecorder to capture the audio stream
        const mediaRecorder = new MediaRecorder(destination.stream, {
          mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm',
        });

        const chunks: BlobPart[] = [];
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
          const audioBlob = new Blob(chunks, { type: 'audio/webm' });
          URL.revokeObjectURL(url);
          audioContext.close();
          resolve(audioBlob);
        };

        mediaRecorder.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('Audio extraction failed'));
        };

        mediaRecorder.start(1000); // Collect data every second
        video.play();

        // Stop when video ends
        video.onended = () => {
          mediaRecorder.stop();
        };

        // Safety timeout for very long videos (2 hours max)
        setTimeout(() => {
          if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
        }, 2 * 60 * 60 * 1000);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load video'));
    };
  });
}
