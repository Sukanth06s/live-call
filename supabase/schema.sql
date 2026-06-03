CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE profiles (
  user_id UUID PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'candidate'
    CHECK (role IN ('candidate', 'hr', 'super_admin')),
  language TEXT NOT NULL DEFAULT 'english'
    CHECK (language IN ('english', 'tamil', 'hindi')),
  display_name TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE profiles TO service_role;

CREATE TABLE interviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id TEXT NOT NULL,
  hr_user_id UUID,
  candidate_user_id UUID,
  candidate_name_snapshot TEXT,
  hr_name_snapshot TEXT,
  language TEXT CHECK (language IN ('english', 'tamil', 'hindi')),
  status TEXT NOT NULL CHECK (status IN ('waiting_for_hr', 'active', 'completed', 'cancelled')),
  ended_reason TEXT CHECK (ended_reason IS NULL OR ended_reason IN (
    'hr_ended',
    'candidate_left_before_hr',
    'hr_disconnect_timeout',
    'candidate_disconnect_timeout',
    'system_error'
  )),
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  final_transcript TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE candidate_videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_user_id UUID NOT NULL,
  hr_user_id UUID,
  interview_id UUID REFERENCES interviews(id),
  room_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('hr_recording', 'candidate_upload')),
  status TEXT NOT NULL CHECK (status IN ('uploading', 'pending_review', 'approved', 'discarded')),
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('video/webm', 'video/mp4')),
  file_size BIGINT CHECK (file_size IS NULL OR file_size <= 52428800),
  duration_seconds INTEGER,
  uploaded_by_user_id UUID,
  approved_by_user_id UUID,
  approved_at TIMESTAMP,
  discarded_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX candidate_videos_candidate_status_idx ON candidate_videos(candidate_user_id, status);
CREATE INDEX candidate_videos_interview_idx ON candidate_videos(interview_id);

CREATE TABLE transcript_blocks (
  id UUID PRIMARY KEY,
  interview_id UUID REFERENCES interviews(id),
  speaker TEXT,
  speaker_user_id UUID,
  content TEXT,
  confidence FLOAT,
  version INTEGER,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);