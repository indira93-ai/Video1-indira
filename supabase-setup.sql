-- ===========================================
-- AI Video Synopsis - Supabase Database Setup
-- ===========================================
-- Run this SQL in your Supabase SQL Editor (Dashboard → SQL Editor)

-- 1. Enable UUID extension
create extension if not exists "uuid-ossp";

-- 2. Profiles table (auto-synced from Auth)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- 3. Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', '')
  );
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 4. Videos table
create table if not exists public.videos (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  title text not null,
  file_name text not null,
  file_size bigint not null,
  storage_path text not null,
  duration numeric default 0,
  status text default 'uploading' check (status in ('uploading', 'processing', 'completed', 'error')),
  error_message text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.videos enable row level security;

create policy "Users can view own videos"
  on public.videos for select
  using (auth.uid() = user_id);

create policy "Users can insert own videos"
  on public.videos for insert
  with check (auth.uid() = user_id);

create policy "Users can update own videos"
  on public.videos for update
  using (auth.uid() = user_id);

create policy "Users can delete own videos"
  on public.videos for delete
  using (auth.uid() = user_id);

-- 5. Video analyses table (transcripts, synopsis, meeting notes)
create table if not exists public.video_analyses (
  id uuid default gen_random_uuid() primary key,
  video_id uuid references public.videos on delete cascade not null unique,
  user_id uuid references auth.users on delete cascade not null,
  
  -- Synopsis fields
  executive_summary text,
  detailed_synopsis text,
  topics jsonb default '[]'::jsonb,
  important_points jsonb default '[]'::jsonb,
  conclusions text,
  key_moments jsonb default '[]'::jsonb,
  
  -- Meeting-specific fields
  meeting_overview text,
  meeting_decisions jsonb default '[]'::jsonb,
  action_items jsonb default '[]'::jsonb,
  unresolved_questions jsonb default '[]'::jsonb,
  
  -- Transcript
  transcript_segments jsonb default '[]'::jsonb,
  speaker_mapping jsonb default '{}'::jsonb,
  
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.video_analyses enable row level security;

create policy "Users can view own analyses"
  on public.video_analyses for select
  using (auth.uid() = user_id);

create policy "Users can insert own analyses"
  on public.video_analyses for insert
  with check (auth.uid() = user_id);

create policy "Users can update own analyses"
  on public.video_analyses for update
  using (auth.uid() = user_id);

create policy "Users can delete own analyses"
  on public.video_analyses for delete
  using (auth.uid() = user_id);

-- 6. Create storage bucket for videos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'videos',
  'videos',
  false,
  5368709120, -- 5GB limit
  array['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'audio/mpeg', 'audio/webm', 'audio/wav', 'audio/mp4']
) on conflict (id) do nothing;

-- 7. Storage policies
create policy "Users can upload videos"
  on storage.objects for insert
  with check (
    bucket_id = 'videos' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can view own videos"
  on storage.objects for select
  using (
    bucket_id = 'videos' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete own videos"
  on storage.objects for delete
  using (
    bucket_id = 'videos' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- 8. Updated_at trigger function
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

create trigger set_videos_updated_at
  before update on public.videos
  for each row execute procedure public.handle_updated_at();

create trigger set_analyses_updated_at
  before update on public.video_analyses
  for each row execute procedure public.handle_updated_at();
