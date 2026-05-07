"use client";

import { useState } from "react";
import { motion } from "framer-motion";

interface LobbyProps {
  onJoinRoom: (roomId: string, userName: string, token?: string) => void;
  isConnected: boolean;
  defaultName?: string;
}

export default function Lobby({ onJoinRoom, isConnected, defaultName }: LobbyProps) {
  const [roomId, setRoomId] = useState("");
  const [userName, setUserName] = useState(defaultName || "");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<"join" | "create">("join");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) return;

    const finalRoomId =
      mode === "create"
        ? `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        : roomId.trim();

    if (!finalRoomId) return;
    onJoinRoom(finalRoomId, userName.trim(), token.trim() || undefined);
  };

  return (
    <div className="min-h-screen bg-[#07070a] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px]" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-purple-600/10 rounded-full blur-[120px]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-600/5 rounded-full blur-[150px]" />

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative w-full max-w-md"
      >
        {/* Card */}
        <div className="bg-[#0f0f14]/80 backdrop-blur-2xl border border-white/[0.06] rounded-3xl p-8 shadow-2xl shadow-black/40">
          {/* Logo / Title */}
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 20, delay: 0.1 }}
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 mb-4 shadow-lg shadow-blue-500/20"
            >
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </motion.div>
            <h1 className="text-2xl font-bold text-white tracking-tight">LiveRoom</h1>
            <p className="text-sm text-gray-400 mt-1">Voice chat with live AI transcription</p>
          </div>

          {/* Mode Toggle */}
          <div className="flex gap-1 p-1 bg-white/[0.04] rounded-xl mb-6 border border-white/[0.04]">
            {(["join", "create"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  mode === m
                    ? "bg-white/[0.08] text-white shadow-sm"
                    : "text-gray-400 hover:text-gray-300"
                }`}
              >
                {m === "join" ? "Join Room" : "Create Room"}
              </button>
            ))}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
                Your Name
              </label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-gray-500 text-sm focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
                required
              />
            </div>

            {mode === "join" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
                    Room ID
                  </label>
                  <input
                    type="text"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    placeholder="Enter room ID"
                    className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-gray-500 text-sm focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider flex justify-between">
                    <span>Agora Token</span>
                    <span className="text-[10px] lowercase opacity-50">(Optional)</span>
                  </label>
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Temp token if required"
                    className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-gray-500 text-sm focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
                  />
                </div>
              </motion.div>
            )}

            <motion.button
              type="submit"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              disabled={!isConnected || !userName.trim() || (mode === "join" && !roomId.trim())}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold text-sm tracking-wide
                shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30
                disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-blue-500/20
                transition-all duration-300"
            >
              {mode === "create" ? "Create & Join Room" : "Join Room"}
            </motion.button>
          </form>

          {/* Connection indicator */}
          <div className="flex items-center justify-center gap-2 mt-6">
            <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-400" : "bg-red-400"} ${isConnected ? "animate-pulse" : ""}`} />
            <span className={`text-xs ${isConnected ? "text-gray-400" : "text-red-400"}`}>
              {isConnected ? "Server connected" : "Connecting..."}
            </span>
          </div>
        </div>

        {/* Subtle bottom text */}
        <p className="text-center text-[11px] text-gray-600 mt-5">
          Powered by Agora · Deepgram · Socket.IO
        </p>
      </motion.div>
    </div>
  );
}
