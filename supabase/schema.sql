CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE interviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  room_id TEXT NOT NULL,

  hr_user_id UUID,
  candidate_user_id UUID,

  status TEXT NOT NULL,

  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,

  final_transcript TEXT,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
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
