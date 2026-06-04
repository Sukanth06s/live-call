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

-- Break architectural link to interviews: candidate_videos is now candidate-centric
CREATE TABLE candidate_videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_user_id UUID NOT NULL,
  hr_user_id UUID,
  interview_id UUID REFERENCES interviews(id),
  room_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('hr_recording', 'candidate_upload')),
  status TEXT NOT NULL CHECK (status IN ('uploading', 'enr', 'anr', 'archived')),
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('video/webm', 'video/mp4')),
  file_size BIGINT CHECK (file_size IS NULL OR file_size <= 52428800),
  duration_seconds INTEGER,
  uploaded_by_user_id UUID,
  approved_at TIMESTAMP WITH TIME ZONE,
  dismissed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Enforce at most 1 active review video (EnR) per candidate globally
CREATE UNIQUE INDEX candidate_single_enr ON candidate_videos(candidate_user_id) WHERE status = 'enr';
CREATE INDEX candidate_videos_candidate_status_idx ON candidate_videos(candidate_user_id, status);
CREATE INDEX candidate_videos_interview_idx ON candidate_videos(interview_id);

-- The candidate_verification table is the finalized verification record for each candidate
CREATE TABLE candidate_verification (
  candidate_user_id UUID PRIMARY KEY REFERENCES profiles(user_id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES candidate_videos(id) ON DELETE RESTRICT,
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('candidate_upload', 'hr_recording')),
  approved_by_hr_user_id UUID REFERENCES profiles(user_id) ON DELETE SET NULL,
  approved_by_hr_name_snapshot TEXT,
  approved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

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

-- SQL Functions
CREATE OR REPLACE FUNCTION approve_candidate_video(
  p_video_id UUID,
  p_hr_user_id UUID,
  p_hr_name_snapshot TEXT
) RETURNS VOID AS $$
DECLARE
  v_candidate_user_id UUID;
  v_storage_path TEXT;
  v_storage_bucket TEXT;
  v_source TEXT;
BEGIN
  -- Check if candidate is already verified
  SELECT candidate_user_id, storage_path, storage_bucket, source
  INTO v_candidate_user_id, v_storage_path, v_storage_bucket, v_source
  FROM candidate_videos
  WHERE id = p_video_id AND status = 'enr';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Video not found or not in EnR status';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM candidate_verification
    WHERE candidate_user_id = v_candidate_user_id AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Candidate already verified';
  END IF;
  
  -- Update candidate_videos status to 'anr'
  UPDATE candidate_videos
  SET status = 'anr',
      updated_at = NOW(),
      approved_at = NOW()
  WHERE id = p_video_id;
  
  -- Insert/upsert candidate_verification
  INSERT INTO candidate_verification (
    candidate_user_id,
    video_id,
    storage_path,
    storage_bucket,
    source,
    approved_by_hr_user_id,
    approved_by_hr_name_snapshot,
    approved_at,
    is_active
  )
  VALUES (
    v_candidate_user_id,
    p_video_id,
    v_storage_path,
    v_storage_bucket,
    v_source,
    p_hr_user_id,
    p_hr_name_snapshot,
    NOW(),
    TRUE
  )
  ON CONFLICT (candidate_user_id)
  DO UPDATE SET
    video_id = EXCLUDED.video_id,
    storage_path = EXCLUDED.storage_path,
    storage_bucket = EXCLUDED.storage_bucket,
    source = EXCLUDED.source,
    approved_by_hr_user_id = EXCLUDED.approved_by_hr_user_id,
    approved_by_hr_name_snapshot = EXCLUDED.approved_by_hr_name_snapshot,
    approved_at = EXCLUDED.approved_at,
    is_active = EXCLUDED.is_active;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reset_candidate_verification(
  p_candidate_user_id UUID
) RETURNS VOID AS $$
BEGIN
  DELETE FROM candidate_verification WHERE candidate_user_id = p_candidate_user_id;
  
  UPDATE candidate_videos
  SET status = 'archived',
      updated_at = NOW()
  WHERE candidate_user_id = p_candidate_user_id AND status = 'anr';
END;
$$ LANGUAGE plpgsql;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE interviews TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE candidate_videos TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE candidate_verification TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE transcript_blocks TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION approve_candidate_video TO service_role;
GRANT EXECUTE ON FUNCTION reset_candidate_verification TO service_role;