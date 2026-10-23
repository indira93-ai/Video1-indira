'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient, signOutUser } from '@/lib/supabase/client';
import {
  Sparkles,
  FileText,
  Users,
  Download,
  Play,
  ArrowRight,
  Zap,
  Shield,
  Search,
  Video,
  LogOut,
} from 'lucide-react';

export default function LandingPage() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(!!session);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    setIsLoggedIn(false);
    await signOutUser();
  };

  const features = [
    {
      icon: <Video className="w-6 h-6 text-rose-400" />,
      title: 'One-Click Meeting Recording',
      description:
        'Record Zoom, Google Meet & Teams meetings with your voice and computer system audio captured simultaneously.',
    },
    {
      icon: <Sparkles className="w-6 h-6" />,
      title: 'AI-Powered Synopsis',
      description:
        'Get executive summaries, key topics, important points, and timestamped highlights automatically.',
    },
    {
      icon: <FileText className="w-6 h-6" />,
      title: 'Smart Transcription',
      description:
        'Full dialogue-wise transcription with precise timestamps powered by Groq Whisper.',
    },
    {
      icon: <Users className="w-6 h-6" />,
      title: 'Speaker Diarization',
      description:
        'AI identifies different speakers and lets you rename them for personalized transcripts.',
    },
    {
      icon: <Search className="w-6 h-6" />,
      title: 'Search & Navigate',
      description:
        'Full-text search across transcripts with click-to-seek video playback synchronization.',
    },
    {
      icon: <Play className="w-6 h-6" />,
      title: 'Synced Video Player',
      description:
        'Watch your video while the transcript auto-scrolls and highlights the current segment.',
    },
    {
      icon: <Download className="w-6 h-6" />,
      title: 'Multi-Format Export',
      description:
        'Export your analysis as TXT, PDF, SRT subtitles, VTT, or Markdown in one click.',
    },
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-surface-950/80 backdrop-blur-xl border-b border-surface-800/50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold gradient-text">VideoSynopsis AI</span>
          </div>
          <div className="flex items-center gap-3">
            {isLoggedIn ? (
              <>
                <Link
                  href="/dashboard"
                  className="btn-primary text-sm"
                >
                  Dashboard
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <button
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-surface-300 hover:text-red-400 hover:bg-red-500/10 border border-surface-700/60 hover:border-red-500/30 text-xs sm:text-sm font-medium transition-all cursor-pointer"
                  title="Sign out of your account"
                  id="sign-out-button"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="hidden sm:inline">Sign Out</span>
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="btn-primary text-sm"
              >
                Create New Account
                <ArrowRight className="w-4 h-4" />
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-500/10 border border-primary-500/20 text-primary-400 text-sm font-medium mb-8 fade-in">
            <Zap className="w-4 h-4" />
            Powered by Groq AI — Lightning Fast
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold leading-tight mb-6 fade-in">
            Transform Videos into
            <span className="gradient-text block mt-2">
              Actionable Insights
            </span>
          </h1>
          <p className="text-lg md:text-xl text-surface-400 max-w-2xl mx-auto mb-10 leading-relaxed fade-in">
            Upload any video or meeting recording. Get AI-generated transcripts,
            summaries, speaker identification, action items, and searchable
            key moments — all in seconds.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center fade-in">
            <Link
              href={isLoggedIn ? '/dashboard' : '/login'}
              className="btn-primary text-lg px-8 py-4"
            >
              {isLoggedIn ? 'Go to Dashboard' : 'Start Analyzing Videos'}
              <ArrowRight className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-2 text-surface-500 text-sm ml-2">
              <Shield className="w-4 h-4" />
              Secure Gmail Access · Free to Use
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">
            Everything You Need
          </h2>
          <p className="text-surface-400 text-center mb-16 text-lg">
            A complete AI video analysis platform built for productivity
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <div
                key={i}
                className="glass-card-hover p-8 group"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500/20 to-accent-500/20 flex items-center justify-center text-primary-400 mb-5 group-hover:scale-110 transition-transform duration-300">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-semibold text-surface-100 mb-3">
                  {feature.title}
                </h3>
                <p className="text-surface-400 leading-relaxed text-sm">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">
            How It Works
          </h2>
          <div className="space-y-12">
            {[
              {
                step: '01',
                title: 'Upload Your Video',
                desc: 'Drag & drop any MP4, WebM, MOV, or MKV file. Large files upload directly to cloud storage with real-time progress.',
              },
              {
                step: '02',
                title: 'AI Processes & Analyzes',
                desc: 'Groq Whisper transcribes the audio in seconds. Then Llama 3.3 generates a comprehensive analysis with speaker detection.',
              },
              {
                step: '03',
                title: 'Review & Export',
                desc: 'Browse your synced transcript, search for keywords, rename speakers, ask AI questions, and export in any format.',
              },
            ].map((item, i) => (
              <div key={i} className="flex gap-6 items-start">
                <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center text-white font-bold text-lg">
                  {item.step}
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">{item.title}</h3>
                  <p className="text-surface-400 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-6 border-t border-surface-800/50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-surface-500 text-sm">
            <Sparkles className="w-4 h-4" />
            VideoSynopsis AI
          </div>
          <p className="text-surface-600 text-sm">
            © 2026 All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
