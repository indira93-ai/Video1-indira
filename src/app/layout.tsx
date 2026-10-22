import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VideoSynopsis AI - Intelligent Video Analysis & Meeting Transcription",
  description:
    "Transform your videos into actionable insights with AI-powered transcription, synopsis generation, speaker diarization, and meeting summaries. Upload any video and get detailed analysis in seconds.",
  keywords: "video analysis, AI transcription, meeting notes, video summary, speaker diarization",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        <div className="fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-surface-950" />
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary-600/8 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent-600/8 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary-500/3 rounded-full blur-3xl" />
        </div>
        {children}
      </body>
    </html>
  );
}
