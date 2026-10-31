'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient, signOutUser } from '@/lib/supabase/client';
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
  Link2,
} from 'lucide-react';
import MeetingRecorder from '@/components/MeetingRecorder';

function YouTubeIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

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
  const [showMeetingRecorder, setShowMeetingRecorder] = useState(false);

  // Upload state
  const [showUpload, setShowUpload] = useState(false);
  const [uploadMode, setUploadMode] = useState<'file' | 'youtube'>('file');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'extracting' | 'analyzing' | 'done' | 'error'>('idle');
  const [uploadError, setUploadError] = useState('');

  // YouTube state
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [youtubeError, setYoutubeError] = useState('');
  const [youtubeStep, setYoutubeStep] = useState('');

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
        .maybeSingle();

      const realProfile: Profile = {
        id: user.id,
        email: profileData?.email || user.email || '',
        full_name:
          profileData?.full_name ||
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email?.split('@')[0] ||
          'User',
        avatar_url:
          profileData?.avatar_url ||
          user.user_metadata?.avatar_url ||
          user.user_metadata?.picture ||
          '',
        created_at: profileData?.created_at || user.created_at || new Date().toISOString(),
      };
      setProfile(realProfile);
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
    await signOutUser();
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

      // If video file is large (> 20MB), extract audio in browser and upload directly to Supabase Storage
      // to keep it within Groq Whisper's 25MB limit without hitting Vercel's 4.5MB function payload limit.
      if (uploadFile.size > 20 * 1024 * 1024) {
        try {
          const audioBlob = await extractAudioFromVideo(uploadFile);
          // Upload extracted audio to Supabase Storage directly
          await supabase.storage
            .from('videos')
            .upload(`${storagePath}.audio.wav`, audioBlob, {
              cacheControl: '3600',
              upsert: true,
            });
        } catch (audioExtractErr) {
          console.warn('Audio extraction notice:', audioExtractErr);
        }
      }

      setUploadStatus('analyzing');

      // Retrieve current session token for resilient authorization on hosted server
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const authHeaders: Record<string, string> = {};
      if (session?.access_token) {
        authHeaders['Authorization'] = `Bearer ${session.access_token}`;
      }

      // Always send videoId as JSON so Vercel's 4.5MB request limit is NEVER exceeded,
      // and the server directly streams from Supabase Storage.
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ videoId: videoRecord.id }),
      });

      if (!response.ok) {
        let serverError = `Server responded with ${response.status}: ${response.statusText}`;
        try {
          const text = await response.text();
          try {
            const err = JSON.parse(text);
            if (err.error) serverError = err.error;
          } catch {
            if (text && text.length < 500) {
              serverError = text;
            }
          }
        } catch {
          // fallback
        }
        throw new Error(serverError);
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

  const handleYouTubeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!youtubeUrl.trim() || youtubeLoading) return;

    setYoutubeLoading(true);
    setYoutubeError('');
    setYoutubeStep('Fetching YouTube transcript & video info...');

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const res = await fetch('/api/youtube', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: youtubeUrl.trim() }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setYoutubeError(data.error || `Failed to analyze YouTube video (${res.status})`);
        setYoutubeLoading(false);
        setYoutubeStep('');
        return;
      }

      setYoutubeStep('Analysis complete! Opening workspace...');
      await fetchVideos();

      setTimeout(() => {
        setShowUpload(false);
        setYoutubeUrl('');
        setYoutubeLoading(false);
        setYoutubeStep('');
        router.push(`/video/${data.videoId}`);
      }, 700);
    } catch (err) {
      setYoutubeError(err instanceof Error ? err.message : 'Failed to analyze YouTube video');
      setYoutubeLoading(false);
      setYoutubeStep('');
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
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowMeetingRecorder(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-semibold rounded-xl shadow-lg shadow-rose-600/25 hover:scale-[1.02] active:scale-[0.98] transition-all text-sm cursor-pointer border border-rose-500/30"
              title="One-click meeting recording with mic voice & computer system audio"
            >
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-300 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
              </span>
              <Video className="w-4 h-4" />
              <span>Meeting Recording</span>
            </button>
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
                  className="w-8 h-8 rounded-full border-2 border-surface-700 object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-accent-600 flex items-center justify-center text-white text-sm font-semibold shadow-sm">
                  {profile?.full_name?.charAt(0)?.toUpperCase() || 'U'}
                </div>
              )}
              <div className="hidden md:flex flex-col text-left">
                <span className="text-sm font-semibold text-surface-200 leading-tight">
                  {profile?.full_name}
                </span>
                <span className="text-xs text-surface-400 leading-tight">
                  {profile?.email}
                </span>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-surface-300 hover:text-red-400 hover:bg-red-500/10 border border-surface-700/60 hover:border-red-500/30 text-xs sm:text-sm font-medium transition-all cursor-pointer"
              title="Sign out of your account"
              id="sign-out-button"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign Out</span>
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
              <div className="flex justify-center items-center">
                <button
                  onClick={() => setShowUpload(true)}
                  className="btn-primary text-sm px-6 py-3"
                >
                  <Upload className="w-4 h-4" />
                  Upload Video
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredVideos.map((video) => {
              const isYT = video.storage_path?.startsWith('youtube:') || video.file_name?.includes('youtube.com');
              return (
                <div
                  key={video.id}
                  className="glass-card-hover p-5 flex flex-col sm:flex-row sm:items-center gap-4 cursor-pointer"
                  onClick={() => {
                    if (video.status === 'completed') {
                      router.push(`/video/${video.id}`);
                    }
                  }}
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${isYT ? 'bg-red-500/10 text-red-400' : 'bg-surface-700/50 text-surface-400'
                    }`}>
                    {isYT ? <YouTubeIcon className="w-6 h-6" /> : <FileVideo className="w-6 h-6" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-surface-100 truncate">{video.title}</h3>
                      {isYT && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                          YouTube
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-sm text-surface-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(video.created_at)}
                      </span>
                      <span>{isYT ? 'Online Video' : formatFileSize(video.file_size)}</span>
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
              );
            })}
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

            {/* Mode Switch Tabs */}
            {uploadStatus === 'idle' && !youtubeLoading && (
              <div className="flex bg-surface-800/80 p-1 rounded-xl mb-6 border border-surface-700/50">
                <button
                  type="button"
                  onClick={() => {
                    setUploadMode('file');
                    setUploadError('');
                    setYoutubeError('');
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all ${uploadMode === 'file'
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'text-surface-400 hover:text-surface-200'
                    }`}
                >
                  <Upload className="w-4 h-4" />
                  Upload File
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUploadMode('youtube');
                    setUploadError('');
                    setYoutubeError('');
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all ${uploadMode === 'youtube'
                    ? 'bg-red-600 text-white shadow-md'
                    : 'text-surface-400 hover:text-surface-200'
                    }`}
                >
                  <YouTubeIcon className="w-4 h-4" />
                  YouTube URL
                </button>
              </div>
            )}

            {uploadStatus === 'idle' && !youtubeLoading && uploadMode === 'file' && (
              <>
                {/* Drop Zone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all duration-300 ${isDragging
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

            {uploadStatus === 'idle' && !youtubeLoading && uploadMode === 'youtube' && (
              <form onSubmit={handleYouTubeSubmit} className="space-y-4">
                <div className="rounded-2xl border border-surface-700/50 p-6 bg-surface-900/40">
                  <div className="w-12 h-12 rounded-xl bg-red-500/10 text-red-400 flex items-center justify-center mx-auto mb-4">
                    <YouTubeIcon className="w-6 h-6" />
                  </div>
                  <h3 className="text-center font-semibold text-surface-200 mb-1">
                    Enter YouTube Video URL
                  </h3>
                  <p className="text-center text-surface-500 text-xs mb-5">
                    Analyze a public YouTube video.
                  </p>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-surface-500">
                      <Link2 className="w-4 h-4" />
                    </div>
                    <input
                      type="url"
                      required
                      placeholder="https://www.youtube.com/watch?v=..."
                      value={youtubeUrl}
                      onChange={(e) => {
                        setYoutubeUrl(e.target.value);
                        if (youtubeError) setYoutubeError('');
                      }}
                      className="w-full pl-10 pr-4 py-3 bg-surface-800/80 border border-surface-700 rounded-xl text-surface-100 placeholder-surface-500 text-sm focus:outline-none focus:border-red-500 transition-colors"
                    />
                  </div>
                </div>

                {youtubeError && (
                  <div className="flex items-start gap-2.5 text-red-400 text-sm p-3.5 rounded-xl bg-red-500/10 border border-red-500/20">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{youtubeError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!youtubeUrl.trim() || youtubeLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-red-600/20"
                >
                  <YouTubeIcon className="w-4 h-4" />
                  Generate Summary
                </button>
              </form>
            )}

            {youtubeLoading && (
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-2xl bg-red-500/10 text-red-400 flex items-center justify-center mx-auto mb-6 animate-pulse">
                  <YouTubeIcon className="w-8 h-8" />
                </div>
                <Loader2 className="w-8 h-8 animate-spin text-red-400 mx-auto mb-4" />
                <h3 className="font-semibold text-surface-200 text-lg mb-2">
                  Analyzing YouTube Video
                </h3>
                <p className="text-surface-400 text-sm max-w-sm mx-auto">
                  {youtubeStep || 'Extracting transcript and generating intelligent insights...'}
                </p>
              </div>
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

      {/* One-Click Meeting Recorder Modal */}
      <MeetingRecorder
        isOpen={showMeetingRecorder}
        onClose={() => setShowMeetingRecorder(false)}
        onSaved={async () => {
          await fetchVideos();
          setShowMeetingRecorder(false);
        }}
      />
    </div>
  );
}

/**
 * Fast & lossless audio extraction:
 * 1. If file size <= 24MB, returns the video file directly! Groq Whisper accepts MP4, WebM, M4A, etc. natively.
 * 2. If file size > 24MB, fast-decodes PCM via AudioContext in ~1s and encodes to 16kHz mono WAV (no playback).
 */
async function extractAudioFromVideo(videoFile: File): Promise<Blob> {
  if (videoFile.size <= 24 * 1024 * 1024) {
    return videoFile;
  }

  try {
    const arrayBuffer = await videoFile.arrayBuffer();
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioContext = new AudioCtx({ sampleRate: 16000 });
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const wavBlob = encodeAudioBufferToWav(audioBuffer);
    await audioContext.close();
    return wavBlob;
  } catch (err) {
    console.warn('Audio decoding fallback to direct file:', err);
    return videoFile;
  }
}

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
