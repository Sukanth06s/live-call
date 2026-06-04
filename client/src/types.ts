export type BlockStatus = "live" | "finalizing" | "final" | "editing";

export type UserRole = "candidate" | "hr" | "super_admin";
export type RoomLanguage = "english" | "tamil" | "hindi";

export type InterviewState = "waiting" | "active" | "transcribing" | "paused" | "ended";
export type CandidateVideoSource = "candidate_upload" | "hr_recording";
export type CandidateVideoStatus = "uploading" | "enr" | "anr" | "archived";

export interface RoomUser {
  id: string;          // Socket ID
  agoraUid?: number;   // Numeric Agora RTC UID
  authUserId: string;  // Supabase Auth UUID
  name: string;        // Display name
  role: UserRole;
  language?: RoomLanguage;
  roomId: string;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isSpeaking: boolean;
  joinedAt: number;
}

export interface ActiveTranscriptionSession {
  isActive: boolean;
  startedBy: string; // HR's ID
  targetSpeakerId: string; // Candidate's ID
  startedAt: number | null;
}

export interface TranscriptSegment {
  text: string;
  isFinal: boolean;
  timestamp: number;
  confidence?: number;
}

export interface TranscriptBlock {
  id: string;
  speakerId: string;       // Transient socket ID for active stream routing
  speakerName: string;     // Stable username (NextAuth name)
  speakerRole?: UserRole;  // Role of the speaker
  content: string;         // Cached concatenated string for simple rendering
  segments: TranscriptSegment[]; // List of structured segments
  status: BlockStatus;     // Lifecycle state machine
  isLive: boolean;         // Kept for backward compatibility
  isFinal: boolean;        // Kept for backward compatibility
  version: number;         // Incremented on every mutation to reconcile stale events
  createdAt: number;
  updatedAt: number;
  editableBy: string[];    // Array of stable usernames allowed to edit
  roomId: string;
  restoredFromHistory?: boolean;
  sourceInterviewId?: string;
  sourceSavedAt?: string;
  sourceHrUserId?: string;
  sourceHrName?: string;
}

export interface RoomState {
  roomId: string;
  language?: RoomLanguage;
  interviewSessionId?: string | null;
  users: RoomUser[];
  blocks: TranscriptBlock[];
  activeTranscriptionSession?: ActiveTranscriptionSession;
  roomStateVersion?: number;
  state?: InterviewState;
}

export interface CandidateVideo {
  id: string;
  candidateUserId: string;
  hrUserId?: string | null;
  interviewId?: string | null;
  source: CandidateVideoSource;
  status: CandidateVideoStatus;
  storageBucket: string;
  storagePath: string;
  fileName?: string | null;
  mimeType: string;
  fileSize?: number | null;
  durationSeconds?: number | null;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  signedUrl?: string | null;
}

export interface CandidateVideoState {
  interviewId: string | null;
  uploadAllowed: boolean;
  reason?: string | null;
  currentVideo?: CandidateVideo | null;
  blockingVideo?: CandidateVideo | null;
  verification?: {
    approvedByHrName: string;
    approvedAt: string;
  } | null;
}
