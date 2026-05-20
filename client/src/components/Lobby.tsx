"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface LobbyProps {
  onJoinRoom: (roomId: string, userName: string, role: string, token?: string) => void;
  isConnected: boolean;
  defaultName?: string;
  joinError?: string | null;
  onClearError?: () => void;
  accessToken?: string;
}

interface ActiveRoom {
  roomId: string;
  state: string;
  participantCount: number;
  createdAt: number;
}

export default function Lobby({ 
  onJoinRoom, 
  isConnected, 
  defaultName,
  joinError,
  onClearError,
  accessToken
}: LobbyProps) {
  const [roomId, setRoomId] = useState("");
  const [userName, setUserName] = useState(defaultName || "");
  const [role, setRole] = useState(typeof window !== "undefined" ? sessionStorage.getItem("intendedRole") || "candidate" : "candidate");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<"join" | "create">("join");
  
  // Super Admin active rooms dashboard state
  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);

  // Fetch active rooms for Super Admin
  const fetchActiveRooms = useCallback(async () => {
    if (role !== "super_admin" || !accessToken) return;
    try {
      setRoomError(null);
      let socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";
      if (socketUrl && !socketUrl.startsWith("http://") && !socketUrl.startsWith("https://")) {
        socketUrl = `https://${socketUrl}`;
      }
      const res = await fetch(`${socketUrl}/api/rooms`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!res.ok) throw new Error("Failed to load active rooms");
      const data = await res.json();
      setActiveRooms(data.rooms || []);
    } catch (err: any) {
      console.error("[Lobby] Error fetching rooms:", err);
      setRoomError(err.message || String(err));
    }
  }, [role, accessToken]);

  // Load rooms on mount & when role becomes super_admin
  useEffect(() => {
    if (role === "super_admin" && accessToken) {
      setLoadingRooms(true);
      fetchActiveRooms().finally(() => setLoadingRooms(false));

      // Continuous 3s Polling for real-time dashboard feel
      const interval = setInterval(fetchActiveRooms, 3000);
      return () => clearInterval(interval);
    }
  }, [role, accessToken, fetchActiveRooms]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) return;

    // Super Admin must click an active room square to join
    if (role === "super_admin") return;

    const finalRoomId =
      mode === "create"
        ? `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        : roomId.trim();

    if (!finalRoomId) return;
    
    sessionStorage.setItem("intendedRole", role);
    onJoinRoom(finalRoomId, userName.trim(), role, token.trim() || undefined);
  };

  const handleJoinActiveRoom = (targetRoomId: string) => {
    if (!userName.trim()) return;
    sessionStorage.setItem("intendedRole", "super_admin");
    onJoinRoom(targetRoomId, userName.trim(), "super_admin");
  };

  return (
    <div className="min-h-screen bg-[#07070a] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-1/4 -left-32 w-[400px] h-[400px] bg-blue-600/10 rounded-full blur-[140px]" />
      <div className="absolute bottom-1/4 -right-32 w-[400px] h-[400px] bg-purple-600/10 rounded-full blur-[140px]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-600/5 rounded-full blur-[160px]" />

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 350, damping: 28 }}
        className="relative w-full max-w-lg"
      >
        {/* Glowing border outline wrapper */}
        <div className="bg-[#0f0f14]/80 backdrop-blur-2xl border border-white/[0.06] hover:border-white/[0.1] rounded-3xl p-8 shadow-2xl shadow-black/60 transition-all duration-300">
          {/* Logo / Title */}
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 450, damping: 18, delay: 0.15 }}
              className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 mb-4 shadow-lg shadow-blue-500/25 relative"
            >
              <div className="absolute inset-0 bg-blue-500 rounded-2xl blur-[12px] opacity-35" />
              <svg className="w-7 h-7 text-white relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </motion.div>
            <h1 className="text-2xl font-bold text-white tracking-tight bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">LiveRoom</h1>
            <p className="text-xs text-gray-400 mt-1 select-none">Voice chat with live AI transcription</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {joinError && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 backdrop-blur-md text-red-200 text-xs space-y-2 relative"
              >
                <div className="flex justify-between items-start">
                  <div className="font-semibold text-red-400 flex items-center gap-1.5 uppercase tracking-wider">
                    <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Failed to Join Room
                  </div>
                  {onClearError && (
                    <button
                      type="button"
                      onClick={onClearError}
                      className="text-red-400 hover:text-red-300 transition-colors p-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                <p className="leading-relaxed">{joinError}</p>
              </motion.div>
            )}

            {/* Your Name Input */}
            <div className="relative">
              <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider select-none">
                Your Name
              </label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.07] rounded-xl text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all duration-300 font-medium shadow-inner"
                required
              />
            </div>

            {/* Premium Interactive Role Selector Tabs */}
            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider select-none">
                Your Role
              </label>
              <div className="grid grid-cols-3 gap-2 bg-white/[0.03] border border-white/[0.06] p-1.5 rounded-xl">
                {[
                  { id: "candidate", label: "Candidate", grad: "from-blue-500 to-cyan-500", glow: "shadow-blue-500/10" },
                  { id: "hr", label: "HR / Interviewer", grad: "from-purple-500 to-indigo-500", glow: "shadow-purple-500/10" },
                  { id: "super_admin", label: "Super Admin", grad: "from-orange-500 to-rose-600", glow: "shadow-orange-500/10" }
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setRole(item.id)}
                    className={`py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-300 cursor-pointer ${
                      role === item.id
                        ? `bg-gradient-to-r ${item.grad} text-white shadow-md ${item.glow}`
                        : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.01]"
                    }`}
                  >
                    {item.id === "super_admin" ? "Admin" : item.id === "hr" ? "HR" : "Candidate"}
                  </button>
                ))}
              </div>
            </div>

            {/* Conditional Views based on role choice */}
            <AnimatePresence mode="wait">
              {role === "super_admin" ? (
                /* Super Admin Dashboard Grid */
                <motion.div
                  key="admin-rooms"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-4 pt-1"
                >
                  <div className="flex items-center justify-between border-b border-white/[0.04] pb-2 select-none">
                    <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                      Active Ongoing Sessions ({activeRooms.length})
                    </span>
                    <button
                      type="button"
                      onClick={fetchActiveRooms}
                      disabled={loadingRooms}
                      className="text-[10px] font-bold text-gray-500 hover:text-indigo-400 transition-colors uppercase cursor-pointer"
                    >
                      {loadingRooms ? "Refreshing..." : "Refresh"}
                    </button>
                  </div>

                  {roomError && (
                    <div className="p-3 text-[11px] bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl">
                      {roomError}
                    </div>
                  )}

                  {activeRooms.length === 0 ? (
                    <div className="relative border border-dashed border-white/[0.06] bg-white/[0.01] rounded-2xl p-7 text-center overflow-hidden flex flex-col items-center justify-center space-y-3 min-h-[160px] select-none">
                      {/* Radar pulses */}
                      <div className="absolute w-24 h-24 rounded-full border border-indigo-500/20 animate-ping opacity-25" />
                      <div className="absolute w-36 h-36 rounded-full border border-indigo-500/10 animate-ping opacity-10" />
                      
                      <div className="w-10 h-10 rounded-full bg-white/[0.02] border border-white/[0.04] flex items-center justify-center text-gray-500">
                        <svg className="w-5 h-5 text-gray-400 opacity-60 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-gray-400">No active rooms found</div>
                        <div className="text-[10px] text-gray-600 mt-0.5">Standing by. Interview rooms will appear here automatically.</div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 max-h-[220px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                      {activeRooms.map((room) => {
                        const isLiveTranscribing = room.state === "transcribing";
                        return (
                          <motion.div
                            key={room.roomId}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handleJoinActiveRoom(room.roomId)}
                            className="bg-white/[0.02] hover:bg-indigo-500/[0.03] border border-white/[0.06] hover:border-indigo-500/30 rounded-2xl p-4 transition-all duration-300 cursor-pointer shadow-md group relative overflow-hidden flex flex-col justify-between aspect-square select-none min-h-[105px]"
                          >
                            {/* Inner ambient glow */}
                            <div className={`absolute -right-6 -bottom-6 w-16 h-16 rounded-full blur-xl opacity-20 transition-all ${
                              isLiveTranscribing ? "bg-emerald-500" : "bg-blue-500"
                            }`} />

                            <div className="space-y-1">
                              <div className="text-xs font-mono font-bold text-gray-300 truncate tracking-wide group-hover:text-white transition-colors">
                                {room.roomId}
                              </div>
                              <div className="flex items-center gap-1 text-[10px] text-gray-500 font-medium">
                                <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                                </svg>
                                <span>{room.participantCount} Participant{room.participantCount !== 1 ? "s" : ""}</span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-2 border-t border-white/[0.03] mt-2">
                              <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                isLiveTranscribing
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                  : room.state === "active"
                                  ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                  : "bg-gray-500/10 text-gray-400 border border-gray-500/20"
                              }`}>
                                {isLiveTranscribing ? "Live" : room.state}
                              </span>
                              <span className="text-[10px] text-indigo-400 font-bold group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                                Join
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                </svg>
                              </span>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              ) : (
                /* Regular Room Creator / Joiner Controls */
                <motion.div
                  key="regular-room"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-4"
                >
                  {/* Mode Toggle for Candidate/HR */}
                  <div className="flex gap-1 p-1 bg-white/[0.03] rounded-xl border border-white/[0.05] select-none">
                    {(["join", "create"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={`flex-1 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
                          mode === m
                            ? "bg-white/[0.07] text-white shadow-sm"
                            : "text-gray-500 hover:text-gray-300"
                        }`}
                      >
                        {m === "join" ? "Join Room" : "Create Room"}
                      </button>
                    ))}
                  </div>

                  {mode === "join" ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider select-none">
                          Room ID
                        </label>
                        <input
                          type="text"
                          value={roomId}
                          onChange={(e) => setRoomId(e.target.value)}
                          placeholder="Enter room ID"
                          className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.07] rounded-xl text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all duration-300 font-medium"
                          required
                        />
                      </div>
                    </div>
                  ) : null}

                  <motion.button
                    type="submit"
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={!isConnected || !userName.trim() || (mode === "join" && !roomId.trim())}
                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold text-xs uppercase tracking-widest cursor-pointer
                      shadow-lg shadow-blue-500/10 hover:shadow-blue-500/25
                      disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:shadow-blue-500/10
                      transition-all duration-300 mt-2"
                  >
                    {mode === "create" ? "Create & Join Room" : "Join Room"}
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </form>

          {/* Connection indicator */}
          <div className="flex items-center justify-center gap-2 mt-6 select-none">
            <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-400" : "bg-red-400"} ${isConnected ? "animate-pulse" : ""}`} />
            <span className={`text-xs font-semibold tracking-wide ${isConnected ? "text-gray-500" : "text-red-400"}`}>
              {isConnected ? "Connected to Server" : "Establishing Connection..."}
            </span>
          </div>
        </div>

        {/* Subtle bottom text */}
        <p className="text-center text-[10px] font-medium text-gray-600 mt-5 tracking-wide select-none">
          Powered by Agora · Deepgram · Socket.IO
        </p>
      </motion.div>
    </div>
  );
}
