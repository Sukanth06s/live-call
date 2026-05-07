// Types for the Live Room application

export interface RoomUser {
  id: string;
  name: string;
  isMuted: boolean;
  isSpeaking: boolean;
  joinedAt: number;
}

export interface TranscriptEntry {
  id: string;
  userId: string;
  userName: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface RoomState {
  roomId: string;
  users: RoomUser[];
  transcripts: TranscriptEntry[];
}
