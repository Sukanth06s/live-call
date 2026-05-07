"use client";

import { motion } from "framer-motion";

interface MuteButtonProps {
  isMuted: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export default function MuteButton({ isMuted, onToggle, disabled }: MuteButtonProps) {
  return (
    <motion.button
      onClick={onToggle}
      disabled={disabled}
      whileTap={{ scale: 0.93 }}
      className={`
        relative w-full py-3.5 rounded-2xl font-semibold text-sm tracking-wide
        transition-all duration-300 ease-out
        flex items-center justify-center gap-2.5
        disabled:opacity-40 disabled:cursor-not-allowed
        ${isMuted
          ? "bg-red-500/15 text-red-400 border border-red-500/20 hover:bg-red-500/25 hover:border-red-500/40"
          : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 hover:border-emerald-500/40"
        }
      `}
    >
      {/* Glow effect */}
      <div
        className={`
          absolute inset-0 rounded-2xl opacity-0 hover:opacity-100 transition-opacity duration-500
          ${isMuted
            ? "shadow-[inset_0_0_20px_rgba(239,68,68,0.1)]"
            : "shadow-[inset_0_0_20px_rgba(16,185,129,0.1)]"
          }
        `}
      />

      {/* Icon */}
      {isMuted ? (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      )}

      {/* Label */}
      <span className="relative z-10">{isMuted ? "Unmute" : "Mute"}</span>

      {/* Pulse ring when live */}
      {!isMuted && (
        <motion.div
          className="absolute -inset-0.5 rounded-2xl border border-emerald-500/30"
          animate={{ scale: [1, 1.03, 1], opacity: [0.3, 0.1, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}
    </motion.button>
  );
}
