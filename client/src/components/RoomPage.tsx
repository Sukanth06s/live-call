"use client";

import { useCallback } from "react";
import { motion } from "framer-motion";
import UserList from "./UserList";
import TranscriptPanel from "./TranscriptPanel";
import MuteButton from "./MuteButton";
import ConnectionStatus from "./ConnectionStatus";
import { RoomUser, TranscriptEntry } from "@/types";

interface RoomPageProps {
  roomId: string;
  userName: string;
  users: RoomUser[];
  transcripts: TranscriptEntry[];
  currentUserId: string | null;
  isMuted: boolean;
  isConnected: boolean;
  isAgoraJoined: boolean;
  isTranscribing: boolean;
  onToggleMute: () => void;
  onLeaveRoom: () => void;
}

export default function RoomPage({
  roomId,
  userName,
  users,
  transcripts,
  currentUserId,
  isMuted,
  isConnected,
  isAgoraJoined,
  isTranscribing,
  onToggleMute,
  onLeaveRoom,
}: RoomPageProps) {
  const copyRoomId = useCallback(() => {
    navigator.clipboard.writeText(roomId);
  }, [roomId]);

  return (
    <div className="h-screen bg-[#07070a] flex relative overflow-hidden">
      {/* Background ambient glow */}
      <div className="fixed top-0 left-1/4 w-[500px] h-[500px] bg-blue-600/5 rounded-full blur-[150px] pointer-events-none" />
      <div className="fixed bottom-0 right-1/4 w-[500px] h-[500px] bg-purple-600/5 rounded-full blur-[150px] pointer-events-none" />

      {/* LEFT SIDEBAR */}
      <motion.aside
        initial={{ x: -300, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="w-80 h-full flex-shrink-0 border-r border-white/[0.06] bg-[#0b0b10]/60 backdrop-blur-xl flex flex-col overflow-hidden"
      >
        {/* Room header */}
        <div className="p-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold text-white">LiveRoom</h1>
              <p className="text-[11px] text-gray-500">Voice + AI Transcription</p>
            </div>
          </div>

          {/* Room ID badge */}
          <button
            onClick={copyRoomId}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-colors group"
          >
            <svg className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span className="text-xs text-gray-400 truncate font-mono">{roomId}</span>
            <span className="ml-auto text-[10px] text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity">Copy</span>
          </button>
        </div>

        {/* Current user info */}
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium text-white">{userName}</p>
              <p className="text-[10px] text-gray-500">
                {isMuted ? "Muted" : "Speaking enabled"}
              </p>
            </div>
          </div>
        </div>

        {/* User list */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <UserList users={users} currentUserId={currentUserId} />
        </div>

        {/* Bottom controls */}
        <div className="p-5 border-t border-white/[0.06] space-y-3">
          <ConnectionStatus
            isConnected={isConnected}
            isAgoraJoined={isAgoraJoined}
            isTranscribing={isTranscribing}
          />

          <div className="pt-2 space-y-2">
            <MuteButton isMuted={isMuted} onToggle={onToggleMute} />

            <motion.button
              onClick={onLeaveRoom}
              whileTap={{ scale: 0.97 }}
              className="w-full py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-gray-400 text-sm font-medium hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all duration-300"
            >
              Leave Room
            </motion.button>
          </div>
        </div>
      </motion.aside>

      {/* RIGHT PANEL - Transcript */}
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="flex-1 flex flex-col min-w-0 h-full overflow-hidden"
      >
        <TranscriptPanel transcripts={transcripts} currentUserId={currentUserId} />
      </motion.main>
    </div>
  );
}
