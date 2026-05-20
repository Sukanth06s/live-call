"use client";

import { useCallback } from "react";
import { motion } from "framer-motion";
import UserList from "./UserList";
import TranscriptPanel from "./TranscriptPanel";
import MuteButton from "./MuteButton";
import ConnectionStatus from "./ConnectionStatus";
import { RoomUser, TranscriptBlock } from "@/types";

interface RoomPageProps {
  roomId: string;
  userName: string;
  users: RoomUser[];
  blocks: TranscriptBlock[];
  currentUserId: string | null;
  userRole?: string;
  isMuted: boolean;
  isConnected: boolean;
  isAgoraJoined: boolean;
  isTranscribing: boolean;
  onToggleMute: () => void;
  onLeaveRoom: () => void;
  onEditBlock: (blockId: string, content: string) => void;
  onClearTranscript: () => void;
  onReplaceTranscript: (content: string) => void;
  onStartTranscription: () => void;
  onStopTranscription: () => void;
}

export default function RoomPage({
  roomId,
  userName,
  users,
  blocks,
  currentUserId,
  userRole,
  isMuted,
  isConnected,
  isAgoraJoined,
  isTranscribing,
  onToggleMute,
  onLeaveRoom,
  onEditBlock,
  onClearTranscript,
  onReplaceTranscript,
  onStartTranscription,
  onStopTranscription,
}: RoomPageProps) {
  const copyRoomId = useCallback(() => {
    navigator.clipboard.writeText(roomId);
  }, [roomId]);

  const currentUser = users.find(u => u.id === currentUserId);
  const resolvedRole = userRole || currentUser?.role || "candidate";
  const isHr = resolvedRole === "hr";

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
              <p className="text-[11px] text-gray-500">Speaker Conversational Workspace</p>
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

          {/* Active Role Pill Badge */}
          <div className="mt-3">
            {resolvedRole === "hr" && (
              <div className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-purple-500/10 to-indigo-500/10 border border-purple-500/20 text-purple-300 font-semibold shadow-inner shadow-purple-500/5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.8)]"></span>
                </span>
                <span className="text-xs">HR / Interviewer</span>
              </div>
            )}
            {resolvedRole === "candidate" && (
              <div className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 text-emerald-300 font-semibold shadow-inner shadow-emerald-500/5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
                </span>
                <span className="text-xs">Candidate</span>
              </div>
            )}
            {resolvedRole === "super_admin" && (
              <div className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-orange-500/10 to-rose-500/10 border border-orange-500/20 text-orange-300 font-semibold shadow-inner shadow-orange-500/5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.8)]"></span>
                </span>
                <span className="text-xs">Super Admin Observer</span>
              </div>
            )}
          </div>
        </div>

        {/* Participants section */}
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
            {resolvedRole === "super_admin" ? (
              <div className="w-full py-4 px-4 rounded-xl bg-orange-500/10 border border-orange-500/20 flex flex-col gap-2 text-orange-300 font-medium text-sm shadow-[0_0_15px_rgba(249,115,22,0.1)] select-none">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.8)]"></span>
                  </span>
                  <span className="font-semibold text-orange-200">Silent Observer Mode</span>
                </div>
                <p className="text-[11px] text-orange-300/70 leading-relaxed font-normal">
                  You are viewing this room anonymously. Your microphone is completely disabled, and you are hidden from candidates and HR.
                </p>
              </div>
            ) : (
              <MuteButton isMuted={isMuted} onToggle={onToggleMute} />
            )}

            {isHr ? (
              !isTranscribing ? (
                <motion.button
                  onClick={onStartTranscription}
                  whileTap={{ scale: 0.97 }}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white text-sm font-semibold shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 transition-all duration-300 cursor-pointer"
                >
                  Start Transcription
                </motion.button>
              ) : (
                <div className="space-y-2">
                  <div className="w-full py-3 px-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between text-emerald-300 font-medium text-sm shadow-[0_0_15px_rgba(16,185,129,0.1)] animate-pulse">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
                      </span>
                      <span>AI Live Transcription Active</span>
                    </div>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-200">Live</span>
                  </div>
                  <motion.button
                    onClick={onStopTranscription}
                    whileTap={{ scale: 0.97 }}
                    className="w-full py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-semibold hover:bg-red-600 hover:text-white hover:border-red-600 transition-all duration-300 cursor-pointer shadow-lg shadow-red-500/5 hover:shadow-red-500/20"
                  >
                    Stop Transcription
                  </motion.button>
                </div>
              )
            ) : (
              !isTranscribing ? (
                <div className="w-full py-3 px-4 rounded-xl bg-white/[0.02] border border-white/[0.05] flex items-center gap-2.5 text-gray-500 text-sm font-medium">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-600 animate-pulse" />
                  <span>Waiting for HR to start AI</span>
                </div>
              ) : (
                <div className="w-full py-3 px-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between text-emerald-300 font-medium text-sm shadow-[0_0_15px_rgba(16,185,129,0.1)] animate-pulse">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
                    </span>
                    <span>AI Transcription Running</span>
                  </div>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-200">Running</span>
                </div>
              )
            )}

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
        <TranscriptPanel
          blocks={blocks}
          currentUserName={userName}
          roomId={roomId}
          onEditBlock={onEditBlock}
          onClearTranscript={onClearTranscript}
          onReplaceTranscript={onReplaceTranscript}
          isTranscribing={isTranscribing}
          isHr={isHr}
          isSuperAdmin={resolvedRole === "super_admin"}
          onStopTranscription={onStopTranscription}
        />
      </motion.main>
    </div>
  );
}

