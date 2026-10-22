# 🎬 VideoSynopsis AI

AI-powered Video & Meeting Intelligence platform built with **Next.js 16 (App Router)**, **Supabase**, and **Groq AI (Whisper Large v3 + LLaMA 3.3 / GPT-OSS)**.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

---

## ✨ Features

- 🔐 **Google OAuth Authentication**: Secure login via Supabase Auth.
- 📤 **High-Speed Video Upload**: Supports MP4, WebM, MOV, and MKV up to 5GB with client-side fast audio extraction.
- 📺 **YouTube URL Analysis**: Paste any YouTube link (videos, shorts) for automatic caption extraction or audio transcription fallback.
- 🎙️ **Groq Whisper Transcription**: High-accuracy speech-to-text with precise segment timestamps.
- 🧠 **Deep AI Synopsis & Meeting Notes**: Executive summary, topic breakdowns, key takeaways, action items, and unresolved questions.
- 🗣️ **Speaker Diarization**: Multi-speaker identification with inline rename editing.
- 💬 **Interactive AI Chat**: Ask questions about any video with timestamped context.
- 🌐 **Multi-Language Subtitles**:
  - Live on-player synced subtitle display with CC toggle.
  - One-click instant translation into English, Telugu, Hindi, Tamil, Kannada, Malayalam, Marathi, Bengali, Spanish, French, German, Japanese, and Arabic.
- 💾 **Export Anywhere**: Download analysis and subtitles as PDF, SRT, VTT, Markdown, or Plain Text.

---

## 🛠️ Tech Stack

- **Framework**: Next.js 16 (Turbopack, Partial Prerendering)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Database & Storage**: Supabase (PostgreSQL + RLS + S3 Storage)
- **AI Models**: Groq Cloud (`whisper-large-v3`, auto-selected LLM `llama-3.3-70b-versatile` / `openai/gpt-oss-120b`)
- **Deployment**: Vercel

---

## 🚀 Quick Start (Local Development)

### 1. Clone & Install Dependencies
```bash
git clone <your-repo-url>
cd video
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
Fill in your credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
GROQ_API_KEY=gsk_your_groq_api_key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Run Database Migrations
Execute the SQL script in `supabase-setup.sql` inside your **Supabase Dashboard → SQL Editor**.

### 4. Start the Dev Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ☁️ Deploying to Vercel

### Step 1: Push Project to GitHub
```bash
git add .
git commit -m "Prepare for Vercel deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

### Step 2: Import into Vercel
1. Go to [vercel.com/new](https://vercel.com/new).
2. Select your imported GitHub repository.
3. In **Environment Variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GROQ_API_KEY`
   - `NEXT_PUBLIC_APP_URL` (Set to `https://your-app-name.vercel.app`)
4. Click **Deploy**.

### Step 3: Configure Supabase Redirect URLs
1. In your **Supabase Dashboard**, navigate to **Authentication → URL Configuration**.
2. Set **Site URL** to your Vercel deployment URL: `https://your-app-name.vercel.app`.
3. Under **Redirect URLs**, add:
   ```
   https://your-app-name.vercel.app/**
   https://your-app-name.vercel.app/auth/callback
   ```
4. Save changes.

---

## 📄 License
MIT License.
