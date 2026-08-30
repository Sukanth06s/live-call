"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TranscriptBlock } from "@/types";
import { formatIstDateTime } from "@/lib/time";

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
  isTranscriptionChanging?: boolean;
  onSaveFinalTranscript?: () => void;
  transcriptSaveStatus?: string | null;
}

export default function TranscriptPanel({
  blocks,
  onClearTranscript,
  onReplaceTranscript,
  isTranscribing = false,
  isHr = false,
  isSuperAdmin = false,
  onStopTranscription,
  isTranscriptionChanging = false,
  onSaveFinalTranscript,
  transcriptSaveStatus,
}: TranscriptPanelProps) {
  const candidateScrollRef = useRef<HTMLDivElement>(null);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");

  // Restored history is rendered as plain final text, then fresh live
  // transcription appends after it in the same visible transcript.
  const candidateBlocks = blocks.filter(
    (b) => b.speakerRole === "candidate" || (!b.speakerRole && b.speakerName !== "HR" && b.speakerName !== "Interviewer")
  );
  const restoredSource = candidateBlocks.find((b) => b.restoredFromHistory);
  const restoredSourceLabel =
    restoredSource?.sourceSavedAt
      ? `Previous transcript saved by ${restoredSource.sourceHrName || "HR"} on ${formatIstDateTime(restoredSource.sourceSavedAt)}`
      : null;

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
            disabled={isTranscriptionChanging}
            className="rounded-lg border border-red-500/30 bg-red-500/15 px-2.5 py-1 text-[10px] font-bold uppercase text-red-400 shadow-md shadow-red-500/5 transition-all duration-300 hover:border-red-600 hover:bg-red-600 hover:text-white hover:shadow-red-500/25 disabled:cursor-not-allowed disabled:opacity-60 sm:ml-2 sm:px-3.5 sm:text-xs"
          >
            {isTranscriptionChanging ? "Stopping..." : "Stop Transcription"}
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
          <div className="grid shrink-0 gap-3 border-b border-white/[0.05] bg-[#0c0c12]/40 px-3 py-3 sm:px-5 sm:py-4">
            <div className="flex min-w-0 items-center gap-2">
              <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)] animate-pulse" />
              <h3 className="min-w-0 text-[11px] font-bold uppercase tracking-widest text-emerald-400 sm:text-xs">
                Candidate Speech Log
              </h3>
            </div>
            
            {/* Actions Bar */}
            {!isSuperAdmin && candidateBlocks.length > 0 && !isEditing && (
              <div className="grid w-full grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                {isHr && onSaveFinalTranscript && (
                  <button
                    onClick={() => {
                      if (window.confirm("Are you sure you want to save this as the final transcript?")) {
                        onSaveFinalTranscript();
                      }
                    }}
                    className="inline-flex h-10 min-w-0 items-center justify-center gap-1 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 text-[10px] font-bold uppercase text-blue-300 transition-all hover:bg-blue-500 hover:text-white sm:text-[11px]"
                    title="Save final transcript under this candidate"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 3v6h8V3M7 21v-8h10v8" />
                    </svg>
                    <span className="hidden sm:inline">Save Final</span>
                    <span className="sm:hidden">Save</span>
                  </button>
                )}
                <button
                  onClick={handleStartOverallEdit}
                  className="inline-flex h-10 min-w-0 items-center justify-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 text-[10px] font-bold uppercase text-emerald-400 transition-all hover:bg-emerald-500 hover:text-white sm:text-[11px]"
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
                    onClick={() => {
                      if (window.confirm("Are you sure you want to clear the entire transcript? This cannot be undone.")) {
                        onClearTranscript();
                      }
                    }}
                    className="inline-flex h-10 min-w-0 items-center justify-center gap-1 rounded-lg border border-red-500/20 bg-red-500/10 px-3 text-[10px] font-bold uppercase text-red-400 transition-all hover:bg-red-500 hover:text-white sm:text-[11px]"
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

            {/* Core live status indicator. Kept below controls to avoid button collisions. */}
            <div className="border-t border-white/[0.04] pt-3 font-mono text-[9px] font-bold uppercase tracking-wider text-gray-500 sm:text-[10px]">
              <span className="inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.025] px-2">
                Engine:
                <span className={isTranscribing ? "text-emerald-400" : "text-gray-500"}>
                  {isTranscribing ? "Connected" : "Idle"}
                </span>
              </span>
            </div>
          </div>

          {/* Box Body */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#07070a]/40 p-3 sm:p-4 lg:p-5">
            {(restoredSourceLabel || transcriptSaveStatus) && (
              <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-white/[0.05] bg-white/[0.025] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                {restoredSourceLabel && (
                  <span className="text-amber-300/80">{restoredSourceLabel}</span>
                )}
                {transcriptSaveStatus && (
                  <span className="text-blue-300/80">{transcriptSaveStatus}</span>
                )}
              </div>
            )}
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
                        const isLive = !block.restoredFromHistory && block.status === "live";
                        return (
                          <motion.span
                            layout
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            key={block.id}
                            className={`inline transition-all duration-200 mr-1.5 ${
                              isLive 
                                ? "text-emerald-300 font-semibold text-emerald-200/95 animate-pulse" 
                                : "text-gray-300 hover:text-white"
                            }`}
                          >
                            {block.restoredFromHistory ? (
                              block.content
                            ) : block.segments && block.segments.length > 0 ? (
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
                          </motion.span>
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
