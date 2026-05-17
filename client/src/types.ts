export type BlockStatus = "live" | "finalizing" | "final" | "editing";

export interface RoomUser {
  id: string;
  name: string;
  isMuted: boolean;
  isSpeaking: boolean;
  joinedAt: number;
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
}

export interface RoomState {
  roomId: string;
  users: RoomUser[];
  blocks: TranscriptBlock[];
}

