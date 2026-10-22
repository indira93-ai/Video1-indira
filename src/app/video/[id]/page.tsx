'use client';

import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { VideoRecord, VideoAnalysis, TranscriptSegment } from '@/lib/types';
import { formatTimestamp } from '@/lib/export';
import {
  exportToTxt,
  exportToSrt,
  exportToVtt,
  exportToMarkdown,
  downloadFile,
} from '@/lib/export';
import {
  ArrowLeft,
  Search,
  Download,
  FileText,
  Users,
  MessageSquare,
  Sparkles,
  ListChecks,
  Lightbulb,
  Clock,
  ChevronDown,
  Send,
  Edit3,
  Check,
  X,
  Play,
  Loader2,
  AlertCircle,
  BookOpen,
} from 'lucide-react';

type TabId = 'synopsis' | 'transcript' | 'meeting' | 'chat';

function VideoDetailContent() {
  const router = useRouter();
  const params = useParams();
  const videoId = params.id as string;
  const supabase = createClient();

  const [video, setVideo] = useState<VideoRecord | null>(null);
  const [analysis, setAnalysis] = useState<VideoAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('synopsis');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // Video player
  const videoRef = useRef<HTMLVideoElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TranscriptSegment[]>([]);

  // Speaker rename
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [newSpeakerName, setNewSpeakerName] = useState('');

  // AI Chat
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // Export
  const [showExport, setShowExport] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }

      const { data: videoData } = await supabase
        .from('videos')
        .select('*')
        .eq('id', videoId)
        .eq('user_id', user.id)
        .single();

      if (!videoData) { router.push('/dashboard'); return; }
      setVideo(videoData);

      // Get signed URL for video playback if it's a stored file
      if (videoData.storage_path && !videoData.storage_path.startsWith('youtube:')) {
        const { data: urlData } = await supabase.storage
          .from('videos')
          .createSignedUrl(videoData.storage_path, 3600);
        if (urlData) setVideoUrl(urlData.signedUrl);
      }

      const { data: analysisData } = await supabase
        .from('video_analyses')
        .select('*')
        .eq('video_id', videoId)
        .eq('user_id', user.id)
        .single();

      if (analysisData) setAnalysis(analysisData);
      setIsLoading(false);
    };
    loadData();
  }, [videoId, router, supabase]);

  // Search transcript
  useEffect(() => {
    if (!analysis || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const query = searchQuery.toLowerCase();
    const results = analysis.transcript_segments.filter((seg) =>
      seg.text.toLowerCase().includes(query) ||
      getSpeakerName(seg.speaker).toLowerCase().includes(query)
    );
    setSearchResults(results);
  }, [searchQuery, analysis]);

  const getSpeakerName = useCallback(
    (speaker: string) => analysis?.speaker_mapping?.[speaker] || speaker,
    [analysis]
  );

  const isYouTube =
    video?.storage_path?.startsWith('youtube:') ||
    video?.file_name?.includes('youtube.com') ||
    video?.file_name?.includes('youtu.be');

  const youtubeId = isYouTube
    ? video?.storage_path?.startsWith('youtube:')
      ? video.storage_path.replace('youtube:', '')
      : video?.file_name?.match(/(?:youtu\.be\/|v=)([\w-]{11})/)?.[1]
    : null;

  const seekTo = (time: number) => {
    if (isYouTube && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: 'seekTo', args: [time, true] }),
        '*'
      );
      setCurrentTime(time);
    } else if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play();
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleSpeakerRename = async (originalName: string) => {
    if (!analysis || !newSpeakerName.trim()) {
      setEditingSpeaker(null);
      return;
    }

    const updatedMapping = {
      ...analysis.speaker_mapping,
      [originalName]: newSpeakerName.trim(),
    };

    const { error } = await supabase
      .from('video_analyses')
      .update({ speaker_mapping: updatedMapping })
      .eq('id', analysis.id);

    if (!error) {
      setAnalysis({ ...analysis, speaker_mapping: updatedMapping });
    }

    setEditingSpeaker(null);
    setNewSpeakerName('');
  };

  const handleChat = async () => {
    if (!chatInput.trim() || chatLoading) return;

    const userMessage = chatInput.trim();
    setChatInput('');
    setChatMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setChatLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, question: userMessage }),
      });

      const data = await res.json();
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.answer || data.error || 'No response' },
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, something went wrong.' },
      ]);
    }

    setChatLoading(false);
  };

  const handleExport = (format: string) => {
    if (!analysis || !video) return;
    const title = video.title;

    switch (format) {
      case 'txt':
        downloadFile(exportToTxt(analysis, title), `${title}.txt`, 'text/plain');
        break;
      case 'md':
        downloadFile(exportToMarkdown(analysis, title), `${title}.md`, 'text/markdown');
        break;
      case 'srt':
        downloadFile(
          exportToSrt(analysis.transcript_segments, analysis.speaker_mapping),
          `${title}.srt`,
          'text/plain'
        );
        break;
      case 'vtt':
        downloadFile(
          exportToVtt(analysis.transcript_segments, analysis.speaker_mapping),
          `${title}.vtt`,
          'text/vtt'
        );
        break;
      case 'pdf':
        handlePdfExport();
        break;
    }
    setShowExport(false);
  };

  const handlePdfExport = async () => {
    if (!analysis || !video) return;
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    const title = video.title;

    doc.setFontSize(18);
    doc.text(title, 20, 20);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated on ${new Date().toLocaleDateString()}`, 20, 28);

    let y = 40;
    const addSection = (heading: string, content: string) => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.setFontSize(14);
      doc.setTextColor(0);
      doc.text(heading, 20, y);
      y += 8;
      doc.setFontSize(10);
      doc.setTextColor(60);
      const lines = doc.splitTextToSize(content, 170);
      lines.forEach((line: string) => {
        if (y > 280) { doc.addPage(); y = 20; }
        doc.text(line, 20, y);
        y += 5;
      });
      y += 8;
    };

    if (analysis.executive_summary) addSection('Executive Summary', analysis.executive_summary);
    if (analysis.detailed_synopsis) addSection('Detailed Synopsis', analysis.detailed_synopsis);
    if (analysis.topics.length > 0) addSection('Topics', analysis.topics.join(', '));
    if (analysis.important_points.length > 0) addSection('Important Points', analysis.important_points.join('\n• '));
    if (analysis.meeting_overview) addSection('Meeting Overview', analysis.meeting_overview);

    if (analysis.action_items.length > 0) {
      addSection(
        'Action Items',
        analysis.action_items
          .map((item) => `[${item.priority}] ${item.task} — ${getSpeakerName(item.assignee)} (${item.deadline})`)
          .join('\n')
      );
    }

    // Add transcript
    doc.addPage();
    y = 20;
    doc.setFontSize(14);
    doc.setTextColor(0);
    doc.text('Full Transcript', 20, y);
    y += 10;

    analysis.transcript_segments.forEach((seg) => {
      if (y > 280) { doc.addPage(); y = 20; }
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(`[${formatTimestamp(seg.start)}] ${getSpeakerName(seg.speaker)}:`, 20, y);
      y += 5;
      doc.setTextColor(40);
      const lines = doc.splitTextToSize(seg.text, 170);
      lines.forEach((line: string) => {
        if (y > 280) { doc.addPage(); y = 20; }
        doc.text(line, 25, y);
        y += 4.5;
      });
      y += 3;
    });

    doc.save(`${title}.pdf`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-surface-400">Loading video analysis...</p>
        </div>
      </div>
    );
  }

  if (!video || !analysis) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-surface-600 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Video Not Found</h2>
          <button onClick={() => router.push('/dashboard')} className="btn-primary mt-4">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'synopsis', label: 'Synopsis', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'transcript', label: 'Transcript', icon: <FileText className="w-4 h-4" /> },
    { id: 'meeting', label: 'Meeting Notes', icon: <ListChecks className="w-4 h-4" /> },
    { id: 'chat', label: 'Ask AI', icon: <MessageSquare className="w-4 h-4" /> },
  ];

  const uniqueSpeakers = [...new Set(analysis.transcript_segments.map((s) => s.speaker))];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Bar */}
      <header className="sticky top-0 z-40 bg-surface-950/80 backdrop-blur-xl border-b border-surface-800/50">
        <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="btn-ghost p-2">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h1 className="font-semibold text-surface-200 truncate max-w-[300px] md:max-w-[500px]">
              {video.title}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
              <input
                type="text"
                placeholder="Search transcript..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-field pl-10 py-2 text-sm w-64"
              />
              {searchQuery && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-surface-500">
                  {searchResults.length} results
                </span>
              )}
            </div>
            {/* Export */}
            <div className="relative">
              <button
                onClick={() => setShowExport(!showExport)}
                className="btn-secondary text-sm py-2"
              >
                <Download className="w-4 h-4" />
                Export
                <ChevronDown className="w-3 h-3" />
              </button>
              {showExport && (
                <div className="absolute right-0 top-full mt-2 w-48 glass-card py-2 shadow-xl z-50">
                  {[
                    { id: 'txt', label: 'Plain Text (.txt)', icon: '📄' },
                    { id: 'md', label: 'Markdown (.md)', icon: '📝' },
                    { id: 'pdf', label: 'PDF Report (.pdf)', icon: '📑' },
                    { id: 'srt', label: 'SRT Subtitles (.srt)', icon: '🎬' },
                    { id: 'vtt', label: 'WebVTT (.vtt)', icon: '🎞️' },
                  ].map((fmt) => (
                    <button
                      key={fmt.id}
                      onClick={() => handleExport(fmt.id)}
                      className="w-full px-4 py-2.5 text-left text-sm text-surface-300 hover:bg-surface-700/50 transition-colors flex items-center gap-3"
                    >
                      <span>{fmt.icon}</span>
                      {fmt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content: Video + Tabs */}
      <div className="flex-1 max-w-[1600px] mx-auto w-full px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-120px)]">
          {/* Left: Video Player + Speaker List */}
          <div className="flex flex-col gap-4">
            {/* Video Player */}
            <div className="glass-card overflow-hidden">
              {isYouTube && youtubeId ? (
                <iframe
                  ref={iframeRef}
                  src={`https://www.youtube.com/embed/${youtubeId}?enablejsapi=1`}
                  title={video?.title || 'YouTube Video'}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="w-full aspect-video bg-black"
                />
              ) : videoUrl ? (
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  onTimeUpdate={handleTimeUpdate}
                  className="w-full aspect-video bg-black"
                />
              ) : (
                <div className="w-full aspect-video bg-surface-900 flex items-center justify-center">
                  <p className="text-surface-500">Video not available</p>
                </div>
              )}
            </div>

            {/* Speakers */}
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-primary-400" />
                <h3 className="font-semibold text-sm">Speakers</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {uniqueSpeakers.map((speaker) => (
                  <div key={speaker} className="flex items-center gap-2 bg-surface-700/50 rounded-lg px-3 py-2">
                    {editingSpeaker === speaker ? (
                      <>
                        <input
                          type="text"
                          value={newSpeakerName}
                          onChange={(e) => setNewSpeakerName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSpeakerRename(speaker);
                            if (e.key === 'Escape') setEditingSpeaker(null);
                          }}
                          className="bg-surface-800 border border-surface-600 rounded px-2 py-1 text-sm w-28 outline-none focus:border-primary-500"
                          autoFocus
                        />
                        <button
                          onClick={() => handleSpeakerRename(speaker)}
                          className="text-emerald-400 hover:text-emerald-300"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingSpeaker(null)}
                          className="text-surface-500 hover:text-surface-300"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{
                            backgroundColor: `hsl(${
                              (uniqueSpeakers.indexOf(speaker) * 137.5) % 360
                            }, 70%, 60%)`,
                          }}
                        />
                        <span className="text-sm text-surface-200">
                          {getSpeakerName(speaker)}
                        </span>
                        <button
                          onClick={() => {
                            setEditingSpeaker(speaker);
                            setNewSpeakerName(getSpeakerName(speaker));
                          }}
                          className="text-surface-500 hover:text-primary-400 ml-1"
                          title="Rename speaker"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Mobile Search */}
            <div className="md:hidden glass-card p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
                <input
                  type="text"
                  placeholder="Search transcript..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input-field pl-10 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Right: Tabbed Content */}
          <div className="flex flex-col glass-card overflow-hidden min-h-0">
            {/* Tab Bar */}
            <div className="flex border-b border-surface-700/50 px-2 bg-surface-800/30 flex-shrink-0">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                    activeTab === tab.id ? 'tab-active' : 'tab-inactive'
                  }`}
                >
                  {tab.icon}
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-5 min-h-0">
              {/* Synopsis Tab */}
              {activeTab === 'synopsis' && (
                <div className="space-y-6 fade-in">
                  {analysis.executive_summary && (
                    <section>
                      <h3 className="flex items-center gap-2 font-semibold text-primary-400 mb-3">
                        <Sparkles className="w-4 h-4" />
                        Executive Summary
                      </h3>
                      <p className="text-surface-300 leading-relaxed text-sm">
                        {analysis.executive_summary}
                      </p>
                    </section>
                  )}

                  {analysis.detailed_synopsis && (
                    <section>
                      <h3 className="flex items-center gap-2 font-semibold text-primary-400 mb-3">
                        <BookOpen className="w-4 h-4" />
                        Detailed Synopsis
                      </h3>
                      <p className="text-surface-300 leading-relaxed text-sm">
                        {analysis.detailed_synopsis}
                      </p>
                    </section>
                  )}

                  {analysis.topics.length > 0 && (
                    <section>
                      <h3 className="font-semibold text-primary-400 mb-3">Key Topics</h3>
                      <div className="flex flex-wrap gap-2">
                        {analysis.topics.map((topic, i) => (
                          <span key={i} className="badge-info">{topic}</span>
                        ))}
                      </div>
                    </section>
                  )}

                  {analysis.important_points.length > 0 && (
                    <section>
                      <h3 className="flex items-center gap-2 font-semibold text-primary-400 mb-3">
                        <Lightbulb className="w-4 h-4" />
                        Important Points
                      </h3>
                      <ul className="space-y-2">
                        {analysis.important_points.map((point, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-surface-300">
                            <span className="text-primary-500 mt-1">•</span>
                            {point}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {analysis.key_moments.length > 0 && (
                    <section>
                      <h3 className="flex items-center gap-2 font-semibold text-primary-400 mb-3">
                        <Clock className="w-4 h-4" />
                        Key Moments
                      </h3>
                      <div className="space-y-2">
                        {analysis.key_moments.map((moment, i) => (
                          <button
                            key={i}
                            onClick={() => seekTo(moment.timestamp)}
                            className="w-full text-left flex items-start gap-3 p-3 rounded-xl bg-surface-700/30 hover:bg-surface-700/50 transition-colors group"
                          >
                            <span className="flex items-center gap-1 text-xs text-primary-400 font-mono bg-primary-500/10 rounded-lg px-2 py-1 flex-shrink-0 group-hover:bg-primary-500/20">
                              <Play className="w-3 h-3" />
                              {formatTimestamp(moment.timestamp)}
                            </span>
                            <div>
                              <p className="text-sm font-medium text-surface-200">
                                {moment.title}
                              </p>
                              <p className="text-xs text-surface-500 mt-0.5">
                                {moment.description}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {analysis.conclusions && (
                    <section>
                      <h3 className="font-semibold text-primary-400 mb-3">Conclusions</h3>
                      <p className="text-surface-300 leading-relaxed text-sm">
                        {analysis.conclusions}
                      </p>
                    </section>
                  )}
                </div>
              )}

              {/* Transcript Tab */}
              {activeTab === 'transcript' && (
                <div className="space-y-1 fade-in">
                  {(searchQuery ? searchResults : analysis.transcript_segments).map((seg) => {
                    const isActive = currentTime >= seg.start && currentTime < seg.end;
                    const speakerColor = `hsl(${
                      (uniqueSpeakers.indexOf(seg.speaker) * 137.5) % 360
                    }, 70%, 60%)`;

                    return (
                      <button
                        key={seg.id}
                        onClick={() => seekTo(seg.start)}
                        className={`w-full text-left p-3 rounded-xl transition-all duration-200 group ${
                          isActive
                            ? 'bg-primary-500/10 border border-primary-500/30'
                            : 'hover:bg-surface-700/30'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <div
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: speakerColor }}
                          />
                          <span
                            className="text-xs font-semibold"
                            style={{ color: speakerColor }}
                          >
                            {getSpeakerName(seg.speaker)}
                          </span>
                          <span className="text-xs text-surface-600 font-mono ml-auto group-hover:text-primary-400 transition-colors">
                            {formatTimestamp(seg.start)}
                          </span>
                        </div>
                        <p className={`text-sm leading-relaxed pl-4 ${
                          isActive ? 'text-surface-100' : 'text-surface-400'
                        }`}>
                          {searchQuery
                            ? highlightText(seg.text, searchQuery)
                            : seg.text}
                        </p>
                      </button>
                    );
                  })}
                  {searchQuery && searchResults.length === 0 && (
                    <div className="text-center py-10">
                      <Search className="w-8 h-8 text-surface-600 mx-auto mb-3" />
                      <p className="text-surface-500">No matches found for &quot;{searchQuery}&quot;</p>
                    </div>
                  )}
                </div>
              )}

              {/* Meeting Notes Tab */}
              {activeTab === 'meeting' && (
                <div className="space-y-6 fade-in">
                  {analysis.meeting_overview && (
                    <section>
                      <h3 className="font-semibold text-primary-400 mb-3">Meeting Overview</h3>
                      <p className="text-surface-300 leading-relaxed text-sm">
                        {analysis.meeting_overview}
                      </p>
                    </section>
                  )}

                  {analysis.meeting_decisions.length > 0 && (
                    <section>
                      <h3 className="flex items-center gap-2 font-semibold text-emerald-400 mb-3">
                        <Check className="w-4 h-4" />
                        Decisions Made
                      </h3>
                      <ul className="space-y-2">
                        {analysis.meeting_decisions.map((d, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-surface-300">
                            <span className="text-emerald-500 mt-1">✓</span>
                            {d}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {analysis.action_items.length > 0 && (
                    <section>
                      <h3 className="flex items-center gap-2 font-semibold text-amber-400 mb-3">
                        <ListChecks className="w-4 h-4" />
                        Action Items
                      </h3>
                      <div className="space-y-3">
                        {analysis.action_items.map((item, i) => (
                          <div
                            key={i}
                            className="p-4 rounded-xl bg-surface-700/30 border border-surface-700/50"
                          >
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <p className="text-sm text-surface-200 font-medium">
                                {item.task}
                              </p>
                              <span
                                className={`badge flex-shrink-0 ${
                                  item.priority === 'high'
                                    ? 'badge-error'
                                    : item.priority === 'medium'
                                    ? 'badge-warning'
                                    : 'badge-info'
                                }`}
                              >
                                {item.priority}
                              </span>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-surface-500">
                              <span>
                                👤 {getSpeakerName(item.assignee)}
                              </span>
                              <span>📅 {item.deadline}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {analysis.unresolved_questions.length > 0 && (
                    <section>
                      <h3 className="flex items-center gap-2 font-semibold text-red-400 mb-3">
                        <AlertCircle className="w-4 h-4" />
                        Unresolved Questions
                      </h3>
                      <ul className="space-y-2">
                        {analysis.unresolved_questions.map((q, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-surface-300">
                            <span className="text-red-500 mt-1">?</span>
                            {q}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {!analysis.meeting_overview &&
                    analysis.meeting_decisions.length === 0 &&
                    analysis.action_items.length === 0 &&
                    analysis.unresolved_questions.length === 0 && (
                      <div className="text-center py-10">
                        <ListChecks className="w-8 h-8 text-surface-600 mx-auto mb-3" />
                        <p className="text-surface-500">
                          This video doesn&apos;t appear to be a meeting, or no meeting-specific data was detected.
                        </p>
                      </div>
                    )}
                </div>
              )}

              {/* AI Chat Tab */}
              {activeTab === 'chat' && (
                <div className="flex flex-col h-full fade-in">
                  <div className="flex-1 overflow-y-auto space-y-4 mb-4">
                    {chatMessages.length === 0 && (
                      <div className="text-center py-10">
                        <MessageSquare className="w-10 h-10 text-surface-600 mx-auto mb-3" />
                        <h3 className="font-semibold text-surface-300 mb-2">
                          Ask anything about this video
                        </h3>
                        <p className="text-surface-500 text-sm mb-6">
                          AI will answer based on the video transcript and analysis
                        </p>
                        <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                          {[
                            'What are the main topics discussed?',
                            'Summarize the key decisions',
                            'Who said what about the budget?',
                            'What action items were assigned?',
                          ].map((q, i) => (
                            <button
                              key={i}
                              onClick={() => {
                                setChatInput(q);
                              }}
                              className="text-xs px-3 py-2 rounded-lg bg-surface-700/50 text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {chatMessages.map((msg, i) => (
                      <div
                        key={i}
                        className={`flex ${
                          msg.role === 'user' ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        <div
                          className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                            msg.role === 'user'
                              ? 'bg-primary-600 text-white rounded-br-sm'
                              : 'bg-surface-700/60 text-surface-200 rounded-bl-sm'
                          }`}
                        >
                          {msg.content}
                        </div>
                      </div>
                    ))}

                    {chatLoading && (
                      <div className="flex justify-start">
                        <div className="bg-surface-700/60 rounded-2xl rounded-bl-sm px-4 py-3">
                          <Loader2 className="w-4 h-4 text-primary-400 animate-spin" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Chat Input */}
                  <div className="flex gap-2 pt-3 border-t border-surface-700/50">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) handleChat();
                      }}
                      placeholder="Ask about this video..."
                      className="input-field py-2.5 text-sm"
                    />
                    <button
                      onClick={handleChat}
                      disabled={!chatInput.trim() || chatLoading}
                      className="btn-primary px-4 flex-shrink-0"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function highlightText(text: string, query: string) {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-primary-500/30 text-primary-200 rounded px-0.5">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

export default function VideoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
          <p className="text-sm">Loading video workspace...</p>
        </div>
      }
    >
      <VideoDetailContent />
    </Suspense>
  );
}

