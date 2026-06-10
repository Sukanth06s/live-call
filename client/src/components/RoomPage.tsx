"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import UserList from "./UserList";
import TranscriptPanel from "./TranscriptPanel";
import MuteButton from "./MuteButton";
import ConnectionStatus from "./ConnectionStatus";
import VideoPlayer, { VideoTrackLike } from "./VideoPlayer";
import CandidateVideoPanel from "./CandidateVideoPanel";
import { RoomUser, TranscriptBlock } from "@/types";

interface RemoteAudioTrackLike {
  getMediaStreamTrack?: () => MediaStreamTrack;
}

interface AgoraRemoteUserLike {
  uid?: string | number;
  audioTrack?: RemoteAudioTrackLike;
  videoTrack?: VideoTrackLike;
}

interface SocketLike {
  on: (event: string, callback: (payload: { roomId?: string }) => void) => void;
  off: (event: string, callback: (payload: { roomId?: string }) => void) => void;
}

interface RoomPageProps {
  roomId: string;
  userName: string;
  users: RoomUser[];
  blocks: TranscriptBlock[];
  currentUserId: string | null;
  userRole?: string;
  localCameraTrack?: VideoTrackLike | null;
  remoteUsers?: AgoraRemoteUserLike[];
  accessToken?: string;
  socket?: SocketLike | null;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isConnected: boolean;
  isAgoraJoined: boolean;
  isTranscribing: boolean;
  isTranscriptionChanging?: boolean;
  transcriptionCountdown?: number | null;
  hrRecovery?: {
    isRecovering: boolean;
    message: string;
    remainingMs: number;
    deadline: number;
  } | null;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onLeaveRoom: () => void;
  onEditBlock: (blockId: string, content: string) => void;
  onClearTranscript: () => void;
  onReplaceTranscript: (content: string) => void;
  onStartTranscription: () => void;
  onStopTranscription: () => void;
  onSaveFinalTranscript?: () => void;
  transcriptSaveStatus?: string | null;
}

type VideoItem = {
  id: string;
  track: VideoTrackLike | null | undefined;
  isVideoEnabled: boolean;
  userName: string;
  role: string;
  isSpeaking?: boolean;
  isLocal?: boolean;
};

export default function RoomPage({
  roomId,
  userName,
  users,
  blocks,
  currentUserId,
  userRole,
  localCameraTrack,
  remoteUsers = [],
  accessToken,
  socket,
  isMuted,
  isVideoEnabled,
  isConnected,
  isAgoraJoined,
  isTranscribing,
  isTranscriptionChanging = false,
  transcriptionCountdown = null,
  hrRecovery = null,
  onToggleMute,
  onToggleVideo,
  onLeaveRoom,
  onEditBlock,
  onClearTranscript,
  onReplaceTranscript,
  onStartTranscription,
  onStopTranscription,
  onSaveFinalTranscript,
  transcriptSaveStatus,
}: RoomPageProps) {
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const copyRoomId = useCallback(() => {
    void navigator.clipboard.writeText(roomId);
  }, [roomId]);

  const currentUser = users.find((u) => u.id === currentUserId);
  const resolvedRole = userRole || currentUser?.role || "candidate";
  const isHr = resolvedRole === "hr";
  const isSuperAdmin = resolvedRole === "super_admin";

  const candidateInRoom = users.some((u) => u.role === "candidate");

  // beforeunload guard — warn HR if they try to close the tab while a candidate is present
  useEffect(() => {
    if (!isHr || !candidateInRoom) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "A candidate is still in this interview. Leaving will interrupt their session.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isHr, candidateInRoom]);

  // HR leave/end handler — shows confirm dialog when candidate is present
  const handleHrLeave = useCallback(() => {
    if (candidateInRoom) {
      setShowEndConfirm(true);
    } else {
      onLeaveRoom();
    }
  }, [candidateInRoom, onLeaveRoom]);
  const visibleRemoteRoomUsers = users.filter((u) => {
    if (u.id === currentUserId) return false;
    return u.role === "candidate" || u.role === "hr";
  });
  const shouldShowLocalVideo = !isSuperAdmin;
  const remoteVideoTracksBySocketId = new Map(
    remoteUsers
      .filter((remoteUser) => remoteUser.videoTrack)
      .map((remoteUser) => [String(remoteUser.uid), remoteUser.videoTrack as VideoTrackLike])
  );

  const videoItems: VideoItem[] = [
    ...(shouldShowLocalVideo
      ? [{
          id: "local",
          track: localCameraTrack,
          isVideoEnabled,
          userName,
          role: resolvedRole,
          isSpeaking: currentUser?.isSpeaking,
          isLocal: true,
        }]
      : []),
    ...visibleRemoteRoomUsers.map((roomUser) => ({
      id: roomUser.id,
      track: roomUser.isVideoEnabled ? remoteVideoTracksBySocketId.get(String(roomUser.agoraUid ?? roomUser.id)) : null,
      isVideoEnabled: roomUser.isVideoEnabled,
      userName: roomUser.name,
      role: roomUser.role,
      isSpeaking: roomUser.isSpeaking,
      isLocal: false,
    })),
  ];
  const shouldShowVideoStrip = videoItems.length > 0;

  const roleLabel =
    resolvedRole === "hr" ? "HR / Interviewer" : resolvedRole === "super_admin" ? "Super Admin Observer" : "Candidate";
  const rolePillClass =
    resolvedRole === "hr"
      ? "from-purple-500/10 to-indigo-500/10 border-purple-500/20 text-purple-300"
      : resolvedRole === "super_admin"
        ? "from-orange-500/10 to-rose-500/10 border-orange-500/20 text-orange-300"
        : "from-emerald-500/10 to-teal-500/10 border-emerald-500/20 text-emerald-300";
  const roleDotClass =
    resolvedRole === "hr" ? "bg-purple-500" : resolvedRole === "super_admin" ? "bg-orange-500" : "bg-emerald-500";

  const renderRolePill = (compact = false) => (
    <div className={`flex items-center gap-2 rounded-lg border bg-gradient-to-r font-semibold shadow-inner ${rolePillClass} ${compact ? "px-2.5 py-1.5 text-[11px]" : "w-full px-3 py-2 text-xs"}`}>
      <span className="relative flex h-2 w-2">
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${roleDotClass}`} />
        <span className={`relative inline-flex h-2 w-2 rounded-full ${roleDotClass}`} />
      </span>
      <span className="truncate">{roleLabel}</span>
    </div>
  );

  const renderRoomIdButton = (compact = false) => (
    <button
      onClick={copyRoomId}
      className={`group flex min-w-0 items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] transition-colors hover:bg-white/[0.06] ${compact ? "px-2.5 py-1.5" : "w-full px-3 py-2"}`}
    >
      <svg className="h-3.5 w-3.5 shrink-0 text-gray-500 transition-colors group-hover:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
      <span className="truncate font-mono text-xs text-gray-400">{roomId}</span>
      {!compact && <span className="ml-auto text-[10px] text-gray-600 opacity-0 transition-opacity group-hover:opacity-100">Copy</span>}
    </button>
  );

  const renderObserverNotice = (compact = false) => (
    <div className={`w-full rounded-xl border border-orange-500/20 bg-orange-500/10 text-orange-300 shadow-[0_0_15px_rgba(249,115,22,0.1)] ${compact ? "px-3 py-2" : "px-4 py-4"}`}>
      <div className="flex items-center gap-2 text-sm font-semibold text-orange-200">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-orange-500" />
        </span>
        <span>Silent Observer Mode</span>
      </div>
      {!compact && (
        <p className="mt-2 text-[11px] font-normal leading-relaxed text-orange-300/70">
          You are viewing this room anonymously. Your microphone is completely disabled, and you are hidden from candidates and HR.
        </p>
      )}
    </div>
  );

  const renderVideoToggleButton = (mobile = false) => (
    <motion.button
      onClick={onToggleVideo}
      whileTap={{ scale: 0.93 }}
      className={`relative flex items-center justify-center gap-2.5 rounded-2xl border font-semibold tracking-wide transition-all duration-300 ${
        mobile ? "min-h-12 px-3 py-3 text-xs" : "py-3.5 text-sm"
      } ${
        isVideoEnabled
          ? "border-sky-500/20 bg-sky-500/15 text-sky-400 hover:bg-sky-500/25"
          : "border-amber-500/20 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
      }`}
    >
      {isVideoEnabled ? (
        <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ) : (
        <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2zM3 3l18 18" />
        </svg>
      )}
      <span>{isVideoEnabled ? "Camera" : "Camera Off"}</span>
    </motion.button>
  );

  const renderTranscriptionControl = (compact = false) => {
    if (isHr) {
      return !isTranscribing ? (
        <motion.button
          onClick={onStartTranscription}
          disabled={isTranscriptionChanging}
          whileTap={{ scale: 0.97 }}
          className={`w-full rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 font-semibold text-white shadow-lg shadow-blue-500/20 transition-all duration-300 hover:shadow-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60 ${compact ? "px-3 py-3 text-xs" : "py-3 text-sm"}`}
        >
          {isTranscriptionChanging ? (transcriptionCountdown ? `Starting in ${transcriptionCountdown}` : "Starting...") : "Start Transcription"}
        </motion.button>
      ) : (
        <div className={compact ? "grid grid-cols-[1fr_auto] gap-2" : "space-y-2"}>
          <div className="flex w-full items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-3 text-xs font-medium text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.1)] sm:px-4 sm:text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              <span className="truncate">{compact ? "AI Live" : "AI Live Transcription Active"}</span>
            </div>
            {!compact && <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200">Live</span>}
          </div>
          <motion.button
            onClick={onStopTranscription}
            disabled={isTranscriptionChanging}
            whileTap={{ scale: 0.97 }}
            className={`rounded-xl border border-red-500/20 bg-red-500/10 font-semibold text-red-400 shadow-lg shadow-red-500/5 transition-all duration-300 hover:border-red-600 hover:bg-red-600 hover:text-white hover:shadow-red-500/20 disabled:cursor-not-allowed disabled:opacity-60 ${compact ? "px-4 py-3 text-xs" : "w-full py-3 text-sm"}`}
          >
            {isTranscriptionChanging ? "Stopping..." : "Stop"}
          </motion.button>
        </div>
      );
    }

    return !isTranscribing ? (
      <div className="flex w-full items-center gap-2.5 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-3 text-xs font-medium text-gray-500 sm:px-4 sm:text-sm">
        <div className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-gray-600" />
        <span className="truncate">Waiting for HR to start AI</span>
      </div>
    ) : (
      <div className="flex w-full items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-3 text-xs font-medium text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.1)] sm:px-4 sm:text-sm">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="truncate">AI Transcription Running</span>
        </div>
      </div>
    );
  };

  const renderMediaControls = (mobile = false) => {
    if (isSuperAdmin) return renderObserverNotice(mobile);

    return (
      <div className="grid grid-cols-2 gap-2">
        <MuteButton isMuted={isMuted} onToggle={onToggleMute} compact={mobile} />
        {renderVideoToggleButton(mobile)}
      </div>
    );
  };

  const renderLeaveButton = (compact = false) => (
    <motion.button
      onClick={isHr ? handleHrLeave : onLeaveRoom}
      whileTap={{ scale: 0.97 }}
      className={`w-full rounded-xl border font-medium transition-all duration-300 ${
        isHr && candidateInRoom
          ? "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300"
          : "border-white/[0.06] bg-white/[0.04] text-gray-400 hover:border-red-500/20 hover:bg-red-500/10 hover:text-red-400"
      } ${compact ? "px-3 py-3 text-xs" : "py-3 text-sm"}`}
    >
      {isHr && candidateInRoom ? "End Interview" : "Leave Room"}
    </motion.button>
  );

  const renderSidebarContent = () => (
    <>
      <div className="border-b border-white/[0.06] p-5">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/20">
            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-bold text-white">LiveRoom</h1>
            <p className="text-[11px] text-gray-500">Speaker Conversational Workspace</p>
          </div>
        </div>
        {renderRoomIdButton()}
        <div className="mt-3">
          {renderRolePill()}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <UserList users={users} currentUserId={currentUserId} />
      </div>

      <div className="space-y-3 border-t border-white/[0.06] p-5">
        <ConnectionStatus isConnected={isConnected} isAgoraJoined={isAgoraJoined} isTranscribing={isTranscribing} />
        <div className="space-y-2 pt-2">
          {renderMediaControls()}
          {renderTranscriptionControl()}
          {renderLeaveButton()}
        </div>
      </div>
    </>
  );

  return (
    <div className="relative flex h-[100dvh] min-h-[100dvh] overflow-hidden bg-[#07070a] text-white lg:flex-row">
      <div className="pointer-events-none fixed left-1/4 top-0 h-[420px] w-[420px] rounded-full bg-blue-600/5 blur-[140px] sm:h-[500px] sm:w-[500px]" />
      <div className="pointer-events-none fixed bottom-0 right-1/4 h-[420px] w-[420px] rounded-full bg-purple-600/5 blur-[140px] sm:h-[500px] sm:w-[500px]" />

      {/* ── HR Recovery Banner ── */}
      <AnimatePresence>
        {hrRecovery?.isRecovering && (
          <motion.div
            key="hr-recovery-banner"
            initial={{ y: -80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-4 bg-amber-500/95 px-4 py-3 shadow-2xl shadow-amber-900/40 backdrop-blur-sm"
          >
            <div className="flex items-center gap-3 text-sm font-semibold text-amber-950">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-800 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-900" />
              </span>
              <span>{hrRecovery.message}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-lg font-bold text-amber-950">
                {Math.ceil(hrRecovery.remainingMs / 1000)}s
              </span>
              <span className="text-xs text-amber-800">remaining</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── End Interview Confirm Dialog (HR only) ── */}
      <AnimatePresence>
        {showEndConfirm && (
          <motion.div
            key="end-confirm-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              className="mx-4 w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#13131a] p-6 shadow-2xl"
            >
              <div className="mb-1 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/15">
                  <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-base font-bold text-white">End Interview?</h2>
              </div>
              <p className="mb-5 mt-2 text-sm leading-relaxed text-gray-400">
                The candidate is still in the room. Ending the interview will close the session and save the transcript.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowEndConfirm(false)}
                  className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.04] py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-white/[0.08]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowEndConfirm(false);
                    onLeaveRoom();
                  }}
                  className="flex-1 rounded-xl bg-red-500/90 py-2.5 text-sm font-semibold text-white shadow-lg shadow-red-500/20 transition-all hover:bg-red-500"
                >
                  End Interview
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.aside
        initial={{ x: -300, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="hidden h-full w-80 shrink-0 flex-col overflow-hidden border-r border-white/[0.06] bg-[#0b0b10]/60 backdrop-blur-xl lg:flex"
      >
        {renderSidebarContent()}
      </motion.aside>

      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="relative z-10 flex h-full min-w-0 flex-1 flex-col overflow-hidden"
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain lg:flex lg:flex-col lg:overflow-y-auto">
          <header className="shrink-0 border-b border-white/[0.06] bg-[#0b0b10]/70 px-3 py-2.5 backdrop-blur-md sm:px-4 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
                    <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <h1 className="truncate text-sm font-bold text-white">LiveRoom</h1>
                    <p className="truncate text-[10px] text-gray-500">Realtime workspace</p>
                  </div>
                </div>
              </div>
              <div className="flex min-w-0 shrink items-center gap-2">
                {renderRoomIdButton(true)}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2 overflow-hidden">
              {renderRolePill(true)}
              <div className={`ml-auto h-2 w-2 shrink-0 rounded-full ${isConnected ? "bg-emerald-400" : "bg-red-400"}`} />
            </div>
          </header>

          <details className="group shrink-0 border-b border-white/[0.06] bg-[#09090d]/90 backdrop-blur-md lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 sm:px-4">
              <span>Participants and Status</span>
              <svg className="h-3.5 w-3.5 text-gray-500 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </summary>
            <div className="grid max-h-[34dvh] gap-3 overflow-y-auto border-t border-white/[0.05] px-3 py-3 sm:grid-cols-[minmax(0,1fr)_260px] sm:px-4">
              <UserList users={users} currentUserId={currentUserId} />
              <ConnectionStatus isConnected={isConnected} isAgoraJoined={isAgoraJoined} isTranscribing={isTranscribing} />
            </div>
          </details>

          {shouldShowVideoStrip && (
            <section className="shrink-0 border-b border-white/[0.06] bg-[#0b0b10]/40 px-3 py-3 backdrop-blur-md sm:px-4 lg:px-6 lg:py-4">
              <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:h-[clamp(170px,27vh,280px)] lg:items-stretch lg:gap-4 lg:overflow-x-auto lg:pb-1">
              {videoItems.map((item) => {
                return (
                  <VideoPlayer
                    key={item.id}
                      track={item.track}
                      isVideoEnabled={item.isVideoEnabled}
                      userName={item.userName}
                    role={item.role}
                    isSpeaking={item.isSpeaking}
                    isLocal={item.isLocal}
                    className="h-[clamp(150px,28dvh,220px)] w-full min-w-0 lg:h-full lg:w-auto lg:min-w-[260px] lg:max-w-[min(52vw,560px)] xl:min-w-[300px]"
                  />
                );
              })}
              </div>
            </section>
          )}

          <div className="min-h-0 flex-1 lg:grid lg:grid-cols-[minmax(420px,0.95fr)_minmax(0,1.05fr)] lg:items-start lg:overflow-visible">
            <CandidateVideoPanel
              roomId={roomId}
              accessToken={accessToken}
              userRole={resolvedRole}
              users={users}
              currentUserId={currentUserId}
              remoteUsers={remoteUsers}
              socket={socket}
              layout="workspace"
            />

            <div className="min-h-[360px] flex-1 overflow-hidden pb-4 sm:min-h-[420px] lg:sticky lg:top-0 lg:h-[100dvh] lg:min-h-0 lg:pb-0">
              <TranscriptPanel
                blocks={blocks}
                currentUserName={userName}
                roomId={roomId}
                onEditBlock={onEditBlock}
                onClearTranscript={onClearTranscript}
                onReplaceTranscript={onReplaceTranscript}
                isTranscribing={isTranscribing}
                isHr={isHr}
                isSuperAdmin={isSuperAdmin}
                onStopTranscription={onStopTranscription}
                isTranscriptionChanging={isTranscriptionChanging}
                onSaveFinalTranscript={onSaveFinalTranscript}
                transcriptSaveStatus={transcriptSaveStatus}
              />
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 z-20 shrink-0 border-t border-white/[0.08] bg-[#0b0b10]/95 px-3 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-2xl shadow-black/50 backdrop-blur-xl lg:hidden">
          <div className="mx-auto grid max-w-3xl gap-2">
            {renderMediaControls(true)}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              {renderTranscriptionControl(true)}
              {renderLeaveButton(true)}
            </div>
          </div>
        </div>
      </motion.main>
    </div>
  );
}
