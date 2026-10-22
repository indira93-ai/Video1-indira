# VideoSynopsis AI - Complete Setup & Deployment Guide

## 📋 Prerequisites
- Node.js 18+ installed
- A Supabase account ([supabase.com](https://supabase.com))
- A Groq Cloud API key ([console.groq.com](https://console.groq.com))
- A Google Cloud project for OAuth authentication
- A GitHub account and Vercel account

---

## 🗄️ Step 1: Set Up Supabase

### 1.1 Create a Supabase Project
1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click **New Project**
3. Choose a project name, database password, and your preferred region

### 1.2 Run the Database Migration
1. Go to **SQL Editor** in your Supabase Dashboard
2. Open the file `supabase-setup.sql` in this project
3. Paste the entire SQL script into the editor and click **Run**
   - Creates the `profiles`, `videos`, and `video_analyses` tables
   - Creates the `videos` storage bucket with security policies
   - Configures triggers for auto-creating user profiles on signup

### 1.3 Obtain Supabase API Keys
1. Go to **Project Settings → API**
2. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY`

---

## 🔐 Step 2: Set Up Google OAuth

### 2.1 Create Google OAuth Credentials
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Navigate to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth 2.0 Client ID**
5. Select Application type: **Web application**
6. Under **Authorized redirect URIs**, add your Supabase callback URL:
   ```
   https://<YOUR_SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback
   ```
   *(Replace `<YOUR_SUPABASE_PROJECT_REF>` with your Supabase reference from Project Settings)*
7. Copy the generated **Client ID** and **Client Secret**

### 2.2 Enable Google Provider in Supabase
1. In Supabase Dashboard, go to **Authentication → Providers**
2. Enable **Google**
3. Paste your **Client ID** and **Client Secret**
4. Click **Save**

---

## 🤖 Step 3: Get Groq API Key

1. Go to [console.groq.com/keys](https://console.groq.com/keys)
2. Click **Create API Key**
3. Copy the key (starts with `gsk_...`)

---

## ⚙️ Step 4: Local Environment Configuration

Copy `.env.example` to `.env.local` and add your keys:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GROQ_API_KEY=gsk_your_groq_api_key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Start the application locally:
```bash
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

---

## ☁️ Step 5: GitHub & Vercel Deployment

### 5.1 Push to GitHub
Run the following terminal commands:
```bash
git add .
git commit -m "Complete VideoSynopsis AI ready for Vercel deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

### 5.2 Deploy on Vercel
1. Log in to [vercel.com](https://vercel.com) and click **Add New... → Project**.
2. Select your GitHub repository and click **Import**.
3. Under **Environment Variables**, add the 5 keys:
   - `NEXT_PUBLIC_SUPABASE_URL`: `https://your-project.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: `your_anon_key`
   - `SUPABASE_SERVICE_ROLE_KEY`: `your_service_role_key`
   - `GROQ_API_KEY`: `gsk_your_groq_api_key`
   - `NEXT_PUBLIC_APP_URL`: `https://your-app-name.vercel.app`
4. Click **Deploy**. Vercel will build and launch your production site.

### 5.3 Connect Production URL to Supabase & Google OAuth
Once Vercel assigns your production domain (e.g. `https://your-app.vercel.app`):
1. **Supabase Dashboard**:
   - Go to **Authentication → URL Configuration**
   - Set **Site URL** to `https://your-app.vercel.app`
   - In **Redirect URLs**, add:
     - `https://your-app.vercel.app/**`
     - `https://your-app.vercel.app/auth/callback`
   - Save changes.
2. **Google Cloud Console**:
   - In your OAuth 2.0 Client ID settings, verify your Supabase redirect URI is present.
   *(Since Supabase handles the Google redirect directly, you do NOT need to add Vercel domain to Google Cloud Console unless using direct Google SDK).*

---

## 🎯 Verified Features & APIs

- **Video Upload**: Fast in-browser audio extraction + Supabase storage upload.
- **YouTube Link Processing**: Dual-mode extraction (captions + Whisper stream fallback).
- **Groq AI Engine**: Transcription with `whisper-large-v3` + dynamic LLM selection.
- **Live Subtitles**: Real-time floating overlay with multi-language instant translation (English, Telugu, Hindi, Tamil, etc.).
- **Exports**: PDF report generation, SRT, VTT, Markdown, and TXT files.
- **Vercel Safe**: Pre-configured `vercel.json`, safe environment fallback during build, clean Next.js 16 build passing with 0 errors.
