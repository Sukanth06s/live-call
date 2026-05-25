"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

export interface VideoTrackLike {
  play: (element: HTMLElement) => void;
  stop?: () => void;
}

interface VideoPlayerProps {
  track: VideoTrackLike | null | undefined;
  isVideoEnabled: boolean;
  userName: string;
  role: string;
  isSpeaking?: boolean;
  isLocal?: boolean;
  className?: string;
  compact?: boolean;
}

export default function VideoPlayer({
  track,
  isVideoEnabled,
  userName,
  role,
  isSpeaking = false,
  isLocal = false,
  className = "h-full min-w-[260px] max-w-[min(52vw,560px)] sm:min-w-[300px]",
  compact = false,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playingTrackRef = useRef<VideoTrackLike | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !track || !isVideoEnabled) {
      if (container) container.replaceChildren();
      playingTrackRef.current = null;
      return;
    }

    if (playingTrackRef.current === track) return;

    try {
      container.replaceChildren();
      track.play(container);
      playingTrackRef.current = track;
    } catch (err) {
      console.warn("[VideoPlayer] Failed to play video track:", err);
    }

    return () => {
      container.replaceChildren();
      playingTrackRef.current = null;
    };
  }, [track, isVideoEnabled]);

  const initial = (userName || "U").charAt(0).toUpperCase();
  const normalizedRole = role === "hr" ? "HR" : role === "super_admin" ? "Admin" : "Candidate";

  return (
    <motion.div
      className={`relative aspect-video flex-none overflow-hidden rounded-xl border bg-[#09090d] shadow-xl sm:rounded-2xl ${className} ${
        isSpeaking
          ? "border-emerald-400/60 shadow-emerald-500/15"
        : "border-white/[0.06] shadow-black/30"
      }`}
    >
      <div
        ref={containerRef}
        className={`absolute inset-0 bg-black [&_*]:!h-full [&_*]:!w-full [&_video]:!h-full [&_video]:!w-full [&_video]:object-cover ${
          track && isVideoEnabled ? "opacity-100" : "opacity-0"
        }`}
      />

      {(!track || !isVideoEnabled) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#09090d] px-3 pb-9 text-gray-500 sm:px-4 sm:pb-10">
          <div className={`${compact ? "mb-2 h-10 w-10 rounded-xl text-sm" : "mb-3 h-14 w-14 rounded-2xl text-lg"} flex items-center justify-center border border-white/[0.05] bg-white/[0.04] font-bold text-gray-200 shadow-inner`}>
            {initial}
          </div>
          <div className={`${compact ? "px-2 py-0.5 text-[8px]" : "px-3 py-1 text-[10px]"} rounded-full border border-white/[0.07] bg-black/20 font-bold uppercase tracking-wider text-gray-400`}>
            Camera Off
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-2.5 pb-2.5 pt-7 sm:px-3 sm:pb-3 sm:pt-8">
        <div className="min-w-0">
          <div className={`${compact ? "text-[10px]" : "text-xs"} truncate font-semibold text-white`}>
            {userName || "Participant"}{isLocal ? " (You)" : ""}
          </div>
        </div>
        <span className={`${compact ? "px-1.5 text-[8px]" : "px-2 text-[9px]"} shrink-0 rounded-md border border-white/10 bg-white/10 py-0.5 font-bold uppercase tracking-wider text-gray-200`}>
          {normalizedRole}
        </span>
      </div>

      {isSpeaking && (
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-2xl border border-emerald-400/70"
          animate={{ opacity: [0.35, 0.9, 0.35] }}
          transition={{ duration: 1.4, repeat: Infinity }}
        />
      )}
    </motion.div>
  );
}
