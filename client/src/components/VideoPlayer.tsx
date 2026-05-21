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
}

export default function VideoPlayer({
  track,
  isVideoEnabled,
  userName,
  role,
  isSpeaking = false,
  isLocal = false,
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
      playingTrackRef.current = null;
    };
  }, [track, isVideoEnabled]);

  const initial = (userName || "U").charAt(0).toUpperCase();
  const normalizedRole = role === "hr" ? "HR" : role === "super_admin" ? "Admin" : "Candidate";

  return (
    <motion.div
      layout
      className={`relative h-full aspect-video min-w-[260px] max-w-[min(52vw,560px)] flex-none overflow-hidden rounded-2xl border bg-[#09090d] shadow-xl ${
        isSpeaking
          ? "border-emerald-400/60 shadow-emerald-500/15"
          : "border-white/[0.06] shadow-black/30"
      }`}
    >
      {track && isVideoEnabled ? (
        <div ref={containerRef} className="absolute inset-0 bg-black [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#09090d] px-4 pb-10 text-gray-500">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.05] bg-white/[0.04] text-lg font-bold text-gray-200 shadow-inner">
            {initial}
          </div>
          <div className="rounded-full border border-white/[0.07] bg-black/20 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Camera Off
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pb-3 pt-8">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-white">
            {userName || "Participant"}{isLocal ? " (You)" : ""}
          </div>
        </div>
        <span className="shrink-0 rounded-md border border-white/10 bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-200">
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
