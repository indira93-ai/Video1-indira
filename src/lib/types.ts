export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface KeyMoment {
  timestamp: number;
  title: string;
  description: string;
}

export interface ActionItem {
  task: string;
  assignee: string;
  deadline: string;
  priority: 'high' | 'medium' | 'low';
}

export interface VideoRecord {
  id: string;
  user_id: string;
  title: string;
  file_name: string;
  file_size: number;
  storage_path: string;
  duration: number;
  status: 'uploading' | 'processing' | 'completed' | 'error';
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface VideoAnalysis {
  id: string;
  video_id: string;
  user_id: string;
  executive_summary: string | null;
  detailed_synopsis: string | null;
  topics: string[];
  important_points: string[];
  conclusions: string | null;
  key_moments: KeyMoment[];
  meeting_overview: string | null;
  meeting_decisions: string[];
  action_items: ActionItem[];
  unresolved_questions: string[];
  transcript_segments: TranscriptSegment[];
  speaker_mapping: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string;
  created_at: string;
}
