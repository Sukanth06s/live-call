"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TranscriptBlock } from "@/types";

interface TranscriptPanelProps {
  blocks: TranscriptBlock[];
  currentUserName: string | null;
  roomId: string;
  onEditBlock: (blockId: string, content: string) => void;
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
    hash |= 0;
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
    hash |= 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

export default function TranscriptPanel({
  blocks,
  currentUserName,
  roomId,
  onEditBlock,
}: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  // Auto-scroll to bottom on new blocks or updates
  useEffect(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current;
      requestAnimationFrame(() => {
        scrollContainer.scrollTo({
          top: scrollContainer.scrollHeight,
          behavior: "smooth",
        });
      });
    }
  }, [blocks]);

  const handleStartEdit = (blockId: string, initialContent: string) => {
    setEditingBlockId(blockId);
    setEditContent(initialContent);
  };

  const handleSaveEdit = (blockId: string) => {
    if (editContent.trim()) {
      onEditBlock(blockId, editContent.trim());
    }
    setEditingBlockId(null);
    setEditContent("");
  };

  const handleCancelEdit = () => {
    setEditingBlockId(null);
    setEditContent("");
  };

  return (
    <div className="flex flex-col h-full bg-[#07070a]">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-white/[0.06] bg-[#0b0b10]/40 backdrop-blur-md">
        <div className="relative flex items-center justify-center w-2 h-2">
          <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
          <div className="absolute w-2.5 h-2.5 rounded-full bg-indigo-500 animate-ping opacity-45" />
        </div>
        <h2 className="text-sm font-bold text-gray-200 tracking-wide">Conversational Workspace</h2>
        <span className="ml-auto text-xs text-gray-500 font-medium">
          {blocks.filter((b) => b.status === "final").length} finalized turns
        </span>
      </div>

      {/* Workspace Conversational Cards Grid */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-6 py-6 space-y-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent relative"
      >
        {blocks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 max-w-sm mx-auto text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.02] border border-white/[0.04] flex items-center justify-center text-gray-400">
              <svg className="w-8 h-8 opacity-40 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-400">Conversational turn aggregates</p>
              <p className="text-xs text-gray-600 mt-1">Speak to reconstruct a collaborative semantic meeting log live.</p>
            </div>
          </div>
        )}

        <div className="flex flex-col min-h-full">
          <div className="flex-1" />
          <AnimatePresence initial={false} mode="popLayout">
            {blocks.map((block) => {
              const isLive = block.status === "live";
              const isOwner = block.editableBy.includes(currentUserName || "");
              const isEditing = editingBlockId === block.id;

              return (
                <motion.div
                  key={block.id}
                  layoutId={`block-${block.id}`}
                  initial={{ opacity: 0, y: 20, scale: 0.98 }}
                  animate={{ 
                    opacity: isLive ? 0.9 : 1, 
                    y: 0, 
                    scale: 1,
                    transition: { type: "spring", stiffness: 350, damping: 25 }
                  }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className={`group relative p-5 rounded-2xl border transition-all duration-300 shadow-md ${
                    isLive
                      ? "bg-indigo-500/[0.02] border-indigo-500/25 shadow-lg shadow-indigo-500/[0.02]"
                      : "bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.03]"
                  }`}
                >
                  {/* Card Metadata / Header */}
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold bg-gradient-to-br ${getUserColor(block.speakerName)} text-white flex-shrink-0 shadow-sm`}
                    >
                      {block.speakerName.charAt(0).toUpperCase()}
                    </div>
                    <span className={`text-xs font-bold tracking-wide ${getTextColor(block.speakerName)}`}>
                      {block.speakerName}
                    </span>
                    <span className="text-[10px] text-gray-600 font-mono font-medium">
                      {formatTime(block.createdAt)}
                    </span>

                    {/* Status Badges */}
                    {isLive && (
                      <span className="ml-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[9px] text-indigo-400 font-semibold animate-pulse">
                        <span className="w-1 h-1 rounded-full bg-indigo-400 animate-ping" />
                        Speaking
                      </span>
                    )}

                    {!isLive && block.status === "final" && (
                      <span className="ml-2 px-1.5 py-0.5 rounded-md bg-white/[0.02] border border-white/[0.04] text-[8px] text-gray-500 font-medium">
                        Synced
                      </span>
                    )}

                    {/* Manual Edit Button Overlay */}
                    {!isLive && isOwner && !isEditing && (
                      <button
                        onClick={() => handleStartEdit(block.id, block.content)}
                        className="ml-auto p-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04] hover:bg-indigo-500/10 hover:border-indigo-500/20 hover:text-indigo-400 text-gray-600 opacity-0 group-hover:opacity-100 transition-all duration-200"
                        title="Edit transcript card"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Card Content (Aggregated segments) */}
                  <div className="text-[13px] leading-relaxed text-gray-200 font-medium tracking-wide">
                    {isEditing ? (
                      <div className="space-y-3 mt-1">
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="w-full min-h-[80px] bg-[#0c0c12] border border-white/[0.08] rounded-xl p-3 text-[13px] text-gray-200 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all font-medium"
                          placeholder="Correct spoken content..."
                          autoFocus
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={handleCancelEdit}
                            className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] text-xs text-gray-400 transition-colors font-semibold"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSaveEdit(block.id)}
                            className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-xs font-semibold hover:shadow-md hover:shadow-indigo-500/10 transition-all"
                          >
                            Save Correction
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="pl-8 whitespace-pre-wrap">
                        {block.segments && block.segments.length > 0 ? (
                          block.segments.map((seg, sIdx) => {
                            const isLowConfidence = !isLive && seg.isFinal && seg.confidence !== undefined && seg.confidence < 0.75;
                            
                            return (
                              <span key={sIdx} className="inline mr-1">
                                {seg.isFinal ? (
                                  <span
                                    className={
                                      isLowConfidence 
                                        ? "border-b border-dashed border-amber-500/70 text-amber-200/90 font-medium" 
                                        : ""
                                    }
                                    title={isLowConfidence ? `Confidence: ${Math.round(seg.confidence! * 100)}%` : undefined}
                                  >
                                    {seg.text}
                                  </span>
                                ) : (
                                  <span className="text-gray-400 italic font-normal">
                                    {seg.text}
                                    <motion.span
                                      animate={{ opacity: [1, 0.2, 1] }}
                                      transition={{ duration: 0.8, repeat: Infinity }}
                                      className="inline-block ml-1 w-1.5 h-3.5 bg-indigo-500 rounded-sm align-middle shadow-[0_0_8px_rgba(99,102,241,0.5)]"
                                    />
                                  </span>
                                )}
                              </span>
                            );
                          })
                        ) : (
                          block.content
                        )}
                      </p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          <div className="h-6 w-full flex-shrink-0" />
        </div>
      </div>
    </div>
  );
}

