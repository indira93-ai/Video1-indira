# VideoSynopsis AI - Setup Guide

## 📋 Prerequisites
- Node.js 18+ installed
- A Supabase account ([supabase.com](https://supabase.com))
- A Groq API key ([console.groq.com](https://console.groq.com))
- A Google Cloud project for OAuth

---

## 🗄️ Step 1: Set Up Supabase

### 1.1 Create a Supabase Project
1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click **New Project**
3. Choose a name, password, and region

### 1.2 Run the Database Migration
1. Go to **SQL Editor** in your Supabase Dashboard
2. Open the file `supabase-setup.sql` from this project
3. Copy the entire SQL content and paste it into the SQL Editor
4. Click **Run** — this creates all tables, RLS policies, storage bucket, and triggers

### 1.3 Get Your Supabase Keys
1. Go to **Project Settings → API**
2. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY`

---

## 🔐 Step 2: Set Up Google OAuth

### 2.1 Create Google OAuth Credentials
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Go to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add Authorized redirect URI:
   ```
   https://<YOUR_SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback
   ```
   (Find your project ref in the Supabase URL, e.g., `abcdefghij.supabase.co`)
7. Copy the **Client ID** and **Client Secret**

### 2.2 Configure Google Provider in Supabase
1. In Supabase Dashboard, go to **Authentication → Providers**
2. Find **Google** and enable it
3. Paste your **Client ID** and **Client Secret**
4. Save

---

## 🤖 Step 3: Get Groq API Key

1. Go to [console.groq.com/keys](https://console.groq.com/keys)
2. Create a new API key
3. Copy it for the next step

---

## ⚙️ Step 4: Configure Environment Variables

Open `.env.local` in the project root and fill in your values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
GROQ_API_KEY=gsk_your_groq_key_here
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## 🚀 Step 5: Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ☁️ Step 6: Deploy to Vercel

### 6.1 Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit: VideoSynopsis AI"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 6.2 Import to Vercel
1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Add the same environment variables from `.env.local` in Vercel's project settings
4. **Important**: Change `NEXT_PUBLIC_APP_URL` to your Vercel deployment URL
5. Deploy!

### 6.3 Update Google OAuth Redirect
After deploying, add your Vercel URL as an additional authorized redirect URI in Google Cloud Console:
```
https://your-app.vercel.app/auth/callback
```

And update the Supabase site URL:
1. Go to Supabase Dashboard → **Authentication → URL Configuration**
2. Set **Site URL** to your Vercel deployment URL
3. Add `https://your-app.vercel.app/**` to **Redirect URLs**

---

## 📁 Project Structure

```
video/
├── .env.local              # Your environment variables
├── .env.example            # Example env file (safe to commit)
├── supabase-setup.sql      # Database migration script
├── next.config.ts          # Next.js configuration
├── src/
│   ├── middleware.ts        # Auth session management
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts    # Browser Supabase client
│   │   │   ├── server.ts    # Server Supabase client
│   │   │   └── middleware.ts # Auth middleware helper
│   │   ├── types.ts         # TypeScript definitions
│   │   └── export.ts        # Export utilities (TXT, SRT, VTT, MD)
│   └── app/
│       ├── layout.tsx       # Root layout with fonts & background
│       ├── globals.css      # Design system & component styles
│       ├── page.tsx         # Landing page
│       ├── login/page.tsx   # Google OAuth login
│       ├── auth/callback/   # OAuth callback handler
│       ├── dashboard/page.tsx # Video list & upload
│       ├── video/[id]/page.tsx # Analysis viewer
│       └── api/
│           ├── analyze/     # Transcription & AI analysis
│           └── chat/        # AI Q&A about videos
```

---

## 🎯 Features

- ✅ Google OAuth login via Gmail
- ✅ Drag & drop video upload (MP4, WebM, MOV, MKV — up to 5GB)
- ✅ AI transcription via Groq Whisper Large v3
- ✅ AI synopsis & meeting analysis via Groq Llama 3.3 70B
- ✅ Speaker diarization with rename capability
- ✅ Synced video player with click-to-seek transcript
- ✅ Full-text transcript search with highlighting
- ✅ Meeting notes: decisions, action items, unresolved questions
- ✅ Multi-format export: TXT, PDF, SRT, VTT, Markdown
- ✅ AI Q&A chat about video content
- ✅ Row Level Security — users only see their own videos
- ✅ Works locally and on Vercel
