"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TranscriptEntry } from "@/types";

interface TranscriptPanelProps {
  transcripts: TranscriptEntry[];
  currentUserId: string | null;
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Generate consistent color for each user
function getUserColor(userId: string): string {
  const colors = [
    "from-blue-500 to-cyan-400",
    "from-purple-500 to-pink-400",
    "from-emerald-500 to-teal-400",
    "from-orange-500 to-amber-400",
    "from-rose-500 to-red-400",
    "from-indigo-500 to-violet-400",
    "from-sky-500 to-blue-400",
    "from-fuchsia-500 to-purple-400",
    "from-yellow-500 to-orange-400",
    "from-lime-500 to-emerald-400",
    "from-violet-600 to-indigo-500",
    "from-pink-600 to-rose-500",
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return colors[Math.abs(hash) % colors.length];
}

function getTextColor(userId: string): string {
  const colors = [
    "text-cyan-400",
    "text-pink-400",
    "text-teal-400",
    "text-amber-400",
    "text-red-400",
    "text-violet-400",
    "text-blue-400",
    "text-purple-400",
    "text-orange-400",
    "text-emerald-400",
    "text-fuchsia-400",
    "text-lime-400",
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return colors[Math.abs(hash) % colors.length];
}

export default function TranscriptPanel({ transcripts, currentUserId }: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new transcript
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [transcripts]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.06]">
        <div className="relative">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping opacity-40" />
        </div>
        <h2 className="text-sm font-semibold text-gray-200 tracking-wide">Live Transcript</h2>
        <span className="ml-auto text-xs text-gray-500">{transcripts.filter(t => t.isFinal).length} messages</span>
      </div>

      {/* Transcript List */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-5 py-4 space-y-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent relative"
      >
        {transcripts.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <svg className="w-12 h-12 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            <p className="text-sm">Start speaking to see live transcription</p>
            <p className="text-xs text-gray-600 mt-1">Your voice will appear here in real-time</p>
          </div>
        )}

        <div className="flex flex-col min-h-full">
          <div className="flex-1" /> {/* Push content to bottom if few messages */}
          <AnimatePresence initial={false}>
            {transcripts.map((entry) => {
              const isMe = entry.userId === currentUserId;
              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: entry.isFinal ? 1 : 0.6, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  className={`group py-2 px-3 rounded-xl transition-colors duration-200 hover:bg-white/[0.03] ${
                    !entry.isFinal ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold bg-gradient-to-br ${getUserColor(entry.userId)} text-white flex-shrink-0`}
                    >
                      {entry.userName.charAt(0).toUpperCase()}
                    </div>
                    <span className={`text-[13px] font-semibold ${getTextColor(entry.userId)}`}>
                      {entry.userName}
                    </span>
                    <span className="text-[10px] text-gray-600 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                      {formatTime(entry.timestamp)}
                    </span>
                  </div>
                  <p className={`text-[13px] leading-relaxed pl-7 ${
                    entry.isFinal ? "text-gray-200" : "text-gray-400 italic"
                  }`}>
                    {entry.text}
                    {!entry.isFinal && (
                      <motion.span
                        animate={{ opacity: [1, 0.3, 1] }}
                        transition={{ duration: 0.8, repeat: Infinity }}
                        className="inline-block ml-1 w-1 h-3 bg-blue-400 rounded-sm align-middle"
                      />
                    )}
                  </p>
                </motion.div>
              );
            })}
          </AnimatePresence>
          <div className="h-4 w-full flex-shrink-0" /> {/* Bottom padding */}
        </div>
      </div>
    </div>
  );
}
