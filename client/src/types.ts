export type BlockStatus = "live" | "finalizing" | "final" | "editing";

export type UserRole = "candidate" | "hr" | "super_admin";

export type InterviewState = "waiting" | "active" | "transcribing" | "paused" | "ended";

export interface RoomUser {
  id: string;          // Socket ID
  authUserId: string;  // Supabase Auth UUID
  name: string;        // Display name
  role: UserRole;
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
  users: RoomUser[];
  blocks: TranscriptBlock[];
}
