"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TranscriptBlock } from "@/types";

interface TranscriptPanelProps {
  blocks: TranscriptBlock[];
  currentUserName: string | null;
  roomId: string;
  onEditBlock: (blockId: string, content: string) => void;
  onClearTranscript?: () => void;
  onReplaceTranscript?: (content: string) => void;
  isTranscribing?: boolean;
  isHr?: boolean;
  isSuperAdmin?: boolean;
  onStopTranscription?: () => void;
}

export default function TranscriptPanel({
  blocks,
  onClearTranscript,
  onReplaceTranscript,
  isTranscribing = false,
  isHr = false,
  isSuperAdmin = false,
  onStopTranscription,
}: TranscriptPanelProps) {
  const candidateScrollRef = useRef<HTMLDivElement>(null);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Track session timer
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isTranscribing) {
      timer = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      timer = setTimeout(() => setElapsedSeconds(0), 0);
    }
    return () => clearInterval(timer);
  }, [isTranscribing]);

  const formatElapsed = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Filter blocks to Candidate Blocks
  const candidateBlocks = blocks.filter(
    (b) => b.speakerRole === "candidate" || (!b.speakerRole && b.speakerName !== "HR" && b.speakerName !== "Interviewer")
  );

  // Auto-scroll panels
  useEffect(() => {
    if (candidateScrollRef.current) {
      const container = candidateScrollRef.current;
      requestAnimationFrame(() => {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: "smooth",
        });
      });
    }
  }, [candidateBlocks, isEditing]);

  // Handle overall transcript editing
  const handleStartOverallEdit = () => {
    const fullText = candidateBlocks.map((b) => b.content).join(" ");
    setEditContent(fullText);
    setIsEditing(true);
  };

  const handleSaveOverallEdit = () => {
    if (onReplaceTranscript) {
      onReplaceTranscript(editContent.trim());
    }
    setIsEditing(false);
  };

  // Word count helper
  const getWordCount = (blockArr: TranscriptBlock[]) => {
    const text = blockArr.map((b) => b.content).join(" ");
    if (!text.trim()) return 0;
    return text.trim().split(/\s+/).length;
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-[#07070a] select-none">
      {/* GLOBAL HEADER */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.06] bg-[#0b0b10]/40 px-3 py-3 backdrop-blur-md sm:gap-3 sm:px-4 lg:px-6 lg:py-4">
        <div className="relative flex items-center justify-center w-2 h-2">
          <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
          <div className="absolute w-2.5 h-2.5 rounded-full bg-indigo-500 animate-ping opacity-45" />
        </div>
        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-200 sm:text-sm">Conversational Workspace</h2>
        
        {/* Active badge */}
        {isTranscribing ? (
          <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-400 select-none sm:px-2.5 sm:text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)] animate-pulse" />
            <span className="hidden sm:inline">Live Deepgram Stream Active</span>
            <span className="sm:hidden">Live</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 rounded-full border border-gray-500/20 bg-gray-500/10 px-2 py-0.5 text-[9px] font-semibold text-gray-400 select-none sm:px-2.5 sm:text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
            Engine Idle
          </span>
        )}

        {/* STOP button inside header */}
        {isHr && isTranscribing && onStopTranscription && (
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={onStopTranscription}
            className="rounded-lg border border-red-500/30 bg-red-500/15 px-2.5 py-1 text-[10px] font-bold uppercase text-red-400 shadow-md shadow-red-500/5 transition-all duration-300 hover:border-red-600 hover:bg-red-600 hover:text-white hover:shadow-red-500/25 sm:ml-2 sm:px-3.5 sm:text-xs"
          >
            Stop Transcription
          </motion.button>
        )}

        {/* Global info metrics */}
        <span className="ml-auto font-mono text-[10px] font-bold uppercase tracking-wider text-gray-500 sm:text-xs">
          Total Blocks: {blocks.length}
        </span>
      </div>

      {/* SINGLE MAIN TRANSCRIPTION CONTENT BOX */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#07070a] p-3 sm:p-4 lg:p-6">
        <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.05] bg-[#0a0a0f]/60 shadow-2xl sm:rounded-3xl">
          
          {/* Box Header */}
          <div className="flex shrink-0 flex-col gap-3 border-b border-white/[0.05] bg-[#0c0c12]/40 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
            <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)] animate-pulse" />
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-emerald-400 sm:text-xs">Candidate Speech Log</h3>
              </div>
              
              {/* Core live stats indicators inside header */}
              <div className="hidden items-center gap-3 border-l border-white/[0.06] pl-4 font-mono text-[10px] font-bold uppercase tracking-wider text-gray-500 md:flex">
                <span className="flex items-center gap-1">
                  Engine: <span className={isTranscribing ? "text-emerald-400" : "text-gray-500"}>{isTranscribing ? "Connected" : "Idle"}</span>
                </span>
                {isTranscribing && (
                  <span className="flex items-center gap-1 text-purple-400">
                    Elapsed: <span>{formatElapsed(elapsedSeconds)}</span>
                  </span>
                )}
              </div>
            </div>
            
            {/* Actions Bar */}
            {!isSuperAdmin && candidateBlocks.length > 0 && !isEditing && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleStartOverallEdit}
                  className="flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-[10px] font-bold uppercase text-emerald-400 transition-all hover:bg-emerald-500 hover:text-white sm:px-3 sm:text-[11px]"
                  title="Edit accumulated transcript content"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                  <span className="hidden sm:inline">Edit Transcript</span>
                  <span className="sm:hidden">Edit</span>
                </button>
                {onClearTranscript && (
                  <button
                    onClick={onClearTranscript}
                    className="flex items-center gap-1 rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-1.5 text-[10px] font-bold uppercase text-red-400 transition-all hover:bg-red-500 hover:text-white sm:px-3 sm:text-[11px]"
                    title="Clear transcript content"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1H9a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    <span className="hidden sm:inline">Clear Box</span>
                    <span className="sm:hidden">Clear</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Box Body */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#07070a]/40 p-3 sm:p-4 lg:p-5">
            {isEditing ? (
              <div className="flex h-full min-h-0 flex-col space-y-3">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="min-h-0 flex-1 w-full resize-none rounded-xl border border-emerald-500/30 bg-[#09090d] p-3 text-sm font-medium leading-relaxed text-gray-200 shadow-inner transition-all focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/20 sm:rounded-2xl sm:p-4"
                  placeholder="Edit candidate transcript..."
                  autoFocus
                />
                <div className="flex shrink-0 justify-end gap-2">
                  <button
                    onClick={() => setIsEditing(false)}
                    className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-2 text-xs font-semibold text-gray-400 transition-colors hover:bg-white/[0.06]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveOverallEdit}
                    className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-emerald-500/10 transition-all hover:shadow-emerald-500/20"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            ) : candidateBlocks.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center space-y-4 p-4 text-center select-none sm:p-6">
                <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.04] bg-white/[0.02] text-emerald-500/40 sm:h-16 sm:w-16">
                  <div className="absolute inset-0 bg-emerald-500 rounded-2xl blur-[15px] opacity-10 animate-pulse" />
                  <svg className="relative z-10 h-7 w-7 sm:h-8 sm:w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-400">Awaiting Candidate Speech...</p>
                  <p className="mx-auto mt-1 max-w-[240px] text-xs leading-relaxed text-gray-600">Spoken sentences will flow here in real time into a single collaborative document.</p>
                </div>
              </div>
            ) : (
              <div 
                ref={candidateScrollRef}
                className="flex-1 overflow-y-auto overscroll-contain rounded-xl border border-white/[0.03] bg-[#08080c]/60 p-4 font-sans text-sm font-medium leading-relaxed tracking-wide text-gray-300 shadow-inner scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/5 sm:rounded-2xl sm:p-5 lg:p-6"
              >
                <div className="flex flex-col min-h-full">
                  <div className="flex-1" />
                  <div>
                    <AnimatePresence initial={false} mode="popLayout">
                      {candidateBlocks.map((block) => {
                        const isLive = block.status === "live";
                        return (
                          <span
                            key={block.id}
                            className={`inline transition-all duration-200 mr-1.5 ${
                              isLive 
                                ? "text-emerald-300 font-semibold text-emerald-200/95 animate-pulse" 
                                : "text-gray-300 hover:text-white"
                            }`}
                          >
                            {block.segments && block.segments.length > 0 ? (
                              block.segments.map((seg, sIdx) => {
                                const isLowConfidence = !isLive && seg.isFinal && seg.confidence !== undefined && seg.confidence < 0.75;
                                return (
                                  <span key={sIdx} className="inline mr-1">
                                    {seg.isFinal ? (
                                      <span
                                        className={isLowConfidence ? "border-b border-dashed border-amber-500/70 text-amber-200" : ""}
                                        title={isLowConfidence ? `Confidence: ${Math.round(seg.confidence! * 100)}%` : undefined}
                                      >
                                        {seg.text}
                                      </span>
                                    ) : (
                                      <span className="text-emerald-400/70 italic font-normal">
                                        {seg.text}
                                        <span className="inline-block ml-1 w-1.5 h-3.5 bg-emerald-500 rounded-sm align-middle shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse" />
                                      </span>
                                    )}
                                  </span>
                                );
                              })
                            ) : (
                              block.content
                            )}
                          </span>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Box Footer Stats */}
          {candidateBlocks.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/[0.04] bg-[#0c0c12]/20 px-3 py-2.5 font-mono text-[9px] font-bold uppercase tracking-wider text-gray-500 sm:px-5 sm:py-3.5 sm:text-[10px]">
              <span>Words logged: {getWordCount(candidateBlocks)}</span>
              <span>Total Turns committed: {candidateBlocks.filter(b => b.status === "final").length}</span>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
