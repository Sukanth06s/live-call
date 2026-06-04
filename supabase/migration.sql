-- Migration Script: Candidate Verification Redesign
-- Run this script in the Supabase Dashboard SQL Editor.

-- 1. Migrate existing candidate_videos data
ALTER TABLE candidate_videos DROP CONSTRAINT IF EXISTS candidate_videos_status_check;

-- Update status strings to match the new status scheme
UPDATE candidate_videos SET status = 'enr' WHERE status = 'pending_review';
UPDATE candidate_videos SET status = 'anr' WHERE status = 'approved';
UPDATE candidate_videos SET status = 'archived' WHERE status = 'discarded';

-- Add status check constraint
ALTER TABLE candidate_videos ADD CONSTRAINT candidate_videos_status_check CHECK (status IN ('uploading', 'enr', 'anr', 'archived'));

-- Ensure standard UTC timestamp fields exist (fallback if not already present)
ALTER TABLE candidate_videos ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE candidate_videos ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMP WITH TIME ZONE;

-- 2. Create the unique index to enforce at most 1 'enr' video per candidate at any point in time
CREATE UNIQUE INDEX IF NOT EXISTS candidate_single_enr
ON candidate_videos(candidate_user_id)
WHERE status = 'enr';

-- 3. Create the candidate_verification table
CREATE TABLE IF NOT EXISTS candidate_verification (
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

-- 4. Create the approve_candidate_video database function
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

-- 5. Create the reset_candidate_verification database function
CREATE OR REPLACE FUNCTION reset_candidate_verification(
  p_candidate_user_id UUID
) RETURNS VOID AS $$
BEGIN
  -- Delete the verification record
  DELETE FROM candidate_verification WHERE candidate_user_id = p_candidate_user_id;
  
  -- Update any active 'anr' videos back to 'archived'
  UPDATE candidate_videos
  SET status = 'archived',
      updated_at = NOW()
  WHERE candidate_user_id = p_candidate_user_id AND status = 'anr';
END;
$$ LANGUAGE plpgsql;

-- 6. Grant privileges to service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE candidate_verification TO service_role;
GRANT EXECUTE ON FUNCTION approve_candidate_video TO service_role;
GRANT EXECUTE ON FUNCTION reset_candidate_verification TO service_role;
