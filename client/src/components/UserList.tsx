"use client";

import { motion, AnimatePresence } from "framer-motion";
import { RoomUser } from "@/types";

interface UserListProps {
  users: RoomUser[];
  currentUserId: string | null;
}

export default function UserList({ users, currentUserId }: UserListProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          In Room — {users.length}
        </h3>
        <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
      </div>
      <AnimatePresence mode="popLayout">
        {users.map((user) => (
          <motion.div
            key={user.id}
            initial={{ opacity: 0, x: -20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.06] transition-all duration-200"
          >
            {/* Avatar */}
            <div className="relative">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold
                  ${user.id === currentUserId
                    ? "bg-gradient-to-br from-blue-500 to-purple-600 text-white"
                    : "bg-gradient-to-br from-gray-600 to-gray-700 text-gray-300"
                  }
                `}
              >
                {(user.name || "U").charAt(0).toUpperCase()}
              </div>
              {/* Speaking indicator ring */}
              {user.isSpeaking && !user.isMuted && (
                <motion.div
                  className="absolute -inset-1 rounded-full border-2 border-emerald-400"
                  animate={{ scale: [1, 1.15, 1], opacity: [0.7, 0.3, 0.7] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
              )}
              {/* Online dot */}
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0f0f14]" />
            </div>

            {/* Name */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-200 truncate">
                {user.name}
                {user.id === currentUserId && (
                  <span className="ml-1.5 text-[10px] font-semibold text-blue-400 uppercase">(You)</span>
                )}
              </p>
            </div>

            {/* Mute indicator */}
            {user.isMuted && (
              <div className="flex-shrink-0">
                <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
              </div>
            )}

            {/* Speaking wave */}
            {user.isSpeaking && !user.isMuted && (
              <div className="flex items-center gap-0.5 flex-shrink-0">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1 bg-emerald-400 rounded-full"
                    animate={{ height: [4, 14, 4] }}
                    transition={{
                      duration: 0.6,
                      repeat: Infinity,
                      delay: i * 0.15,
                    }}
                  />
                ))}
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>

      {users.length === 0 && (
        <div className="text-center py-8 text-gray-500 text-sm">
          No one here yet...
        </div>
      )}
    </div>
  );
}
