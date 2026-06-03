"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { CandidateVideoState, RoomUser } from "@/types";

type RemoteTrackLike = {
  getMediaStreamTrack?: () => MediaStreamTrack;
};

type RemoteUserLike = {
  uid?: string | number;
  audioTrack?: RemoteTrackLike;
  videoTrack?: RemoteTrackLike;
};

type SocketLike = {
  on: (event: string, callback: (payload: { roomId?: string }) => void) => void;
  off: (event: string, callback: (payload: { roomId?: string }) => void) => void;
};

type RecordingState = "idle" | "recording" | "preview" | "saving" | "saved" | "discarded";

interface CandidateVideoPanelProps {
  roomId: string;
  accessToken?: string;
  userRole: string;
  users: RoomUser[];
  currentUserId: string | null;
  remoteUsers: RemoteUserLike[];
  socket?: SocketLike | null;
}

const maxVideoBytes = 50 * 1024 * 1024;
const allowedMimeTypes = new Set(["video/webm", "video/mp4"]);

function getSocketUrl() {
  let socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";
  if (socketUrl && !socketUrl.startsWith("http://") && !socketUrl.startsWith("https://")) {
    socketUrl = `https://${socketUrl}`;
  }
  return socketUrl;
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

export default function CandidateVideoPanel({
  roomId,
  accessToken,
  userRole,
  users,
  remoteUsers,
  socket,
}: CandidateVideoPanelProps) {
  const [videoState, setVideoState] = useState<CandidateVideoState | null>(null);
  const [isLoadingState, setIsLoadingState] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  const discardRecordingRef = useRef(false);
  const candidateUser = users.find((user) => user.role === "candidate");
  const candidateRemoteUser = candidateUser?.agoraUid ? remoteUsers.find((remoteUser) => String(remoteUser.uid) === String(candidateUser.agoraUid)) || null : null;

  const isCandidate = userRole === "candidate";
  const isHr = userRole === "hr";
  const isSuperAdmin = userRole === "super_admin";

  const apiFetch = useCallback(async (path: string, init?: RequestInit) => {
    if (!accessToken) throw new Error("Missing session token");
    const res = await fetch(`${getSocketUrl()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }, [accessToken]);

  const refreshVideoState = useCallback(async () => {
    if (!accessToken || !roomId) return;
    setIsLoadingState(true);
    try {
      const data = await apiFetch(`/api/candidate-videos/state?roomId=${encodeURIComponent(roomId)}`);
      setVideoState(data);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingState(false);
    }
  }, [accessToken, apiFetch, roomId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshVideoState(), 0);
    const interval = window.setInterval(refreshVideoState, 5000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [refreshVideoState]);

  useEffect(() => {
    if (!socket) return;
    const handler = (payload: { roomId?: string }) => {
      if (!payload.roomId || payload.roomId === roomId) void refreshVideoState();
    };
    socket.on("candidate-video-updated", handler);
    return () => socket.off("candidate-video-updated", handler);
  }, [refreshVideoState, roomId, socket]);

  useEffect(() => {
    if (recordingState !== "recording") return;
    const interval = window.setInterval(() => {
      const startedAt = recordingStartedAtRef.current || Date.now();
      setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => window.clearInterval(interval);
  }, [recordingState]);

  const discardPreview = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setRecordingBlob(null);
    chunksRef.current = [];
    setRecordingState("discarded");
    setRecordingSeconds(0);
  }, [previewUrl]);

  const stopRecording = useCallback((discard = false) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    discardRecordingRef.current = discard;
    recorder.stop();
  }, []);

  useEffect(() => {
    const candidateStillPresent = users.some((user) => user.role === "candidate");
    const hrStillPresent = users.some((user) => user.role === "hr");
    if (recordingState === "recording" && (!candidateStillPresent || !hrStillPresent)) {
      stopRecording(true);
      window.setTimeout(() => {
        setMessage("Candidate/HR disconnected from the call. Video recording stopped and discarded.");
      }, 0);
    }
  }, [recordingState, stopRecording, users]);

  const uploadToSignedUrl = useCallback(async (upload: { path: string; token: string }, file: Blob) => {
    const { error } = await supabase.storage
      .from("candidate-videos")
      .uploadToSignedUrl(upload.path, upload.token, file);
    if (error) throw error;
  }, []);

  const handleCandidateFile = async (file: File | null) => {
    if (!file) return;
    setMessage(null);
    if (!allowedMimeTypes.has(file.type)) {
      setMessage("Only WebM and MP4 videos are allowed.");
      return;
    }
    if (file.size > maxVideoBytes) {
      setMessage("Video must be 50 MB or smaller.");
      return;
    }

    setIsUploading(true);
    try {
      const init = await apiFetch("/api/candidate-videos/init-upload", {
        method: "POST",
        body: JSON.stringify({ roomId, fileName: file.name, mimeType: file.type, fileSize: file.size }),
      });
      await uploadToSignedUrl(init.upload, file);
      await apiFetch(`/api/candidate-videos/${init.video.id}/complete-upload`, { method: "POST" });
      setMessage("Verification video uploaded for HR review.");
      await refreshVideoState();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const reviewVideo = async (action: "approve" | "dismiss") => {
    const videoId = videoState?.currentVideo?.id;
    if (!videoId) return;
    setMessage(null);
    try {
      await apiFetch(`/api/candidate-videos/${videoId}/${action}`, { method: "POST" });
      setMessage(action === "approve" ? "Verification video approved." : "Verification video dismissed. Candidate can upload again.");
      await refreshVideoState();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const startRecording = () => {
    setMessage(null);
    if (recordingState === "recording" || recordingState === "preview" || recordingState === "saving") return;
    const videoTrack = candidateRemoteUser?.videoTrack?.getMediaStreamTrack?.();
    const audioTrack = candidateRemoteUser?.audioTrack?.getMediaStreamTrack?.();
    if (!videoTrack || !audioTrack) {
      setMessage("Candidate audio and video must be available before recording.");
      return;
    }

    const stream = new MediaStream([videoTrack, audioTrack]);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    discardRecordingRef.current = false;
    recorderRef.current = recorder;
    recordingStartedAtRef.current = Date.now();
    setRecordingSeconds(0);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      recorderRef.current = null;
      recordingStartedAtRef.current = null;
      if (discardRecordingRef.current) {
        chunksRef.current = [];
        setRecordingBlob(null);
        setRecordingState("discarded");
        return;
      }
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      chunksRef.current = [];
      const nextPreviewUrl = URL.createObjectURL(blob);
      setRecordingBlob(blob);
      setPreviewUrl(nextPreviewUrl);
      setRecordingState("preview");
    };

    recorder.start(1000);
    setRecordingState("recording");
  };

  const saveRecording = async () => {
    if (!recordingBlob) return;
    setMessage(null);
    if (recordingBlob.size > maxVideoBytes) {
      setMessage("Recording is larger than 50 MB. Delete it and record a shorter clip.");
      return;
    }

    setRecordingState("saving");
    try {
      const fileName = `candidate-recording-${Date.now()}.webm`;
      const init = await apiFetch("/api/candidate-videos/hr-recording/init-upload", {
        method: "POST",
        body: JSON.stringify({
          roomId,
          fileName,
          mimeType: "video/webm",
          fileSize: recordingBlob.size,
          durationSeconds: recordingSeconds,
        }),
      });
      await uploadToSignedUrl(init.upload, recordingBlob);
      await apiFetch(`/api/candidate-videos/${init.video.id}/complete-upload`, { method: "POST" });
      discardPreview();
      setRecordingState("saved");
      setMessage("Candidate recording saved and approved.");
      await refreshVideoState();
    } catch (err) {
      setRecordingState("preview");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  if (!isCandidate && !isHr && !isSuperAdmin) return null;

  const currentVideo = videoState?.currentVideo;
  const showCandidateUpload = isCandidate && videoState?.uploadAllowed && !isUploading;
  const showPendingCandidateStatus = isCandidate && !videoState?.uploadAllowed && videoState?.reason;
  const canReview = isHr && currentVideo?.source === "candidate_upload" && currentVideo.status === "pending_review" && currentVideo.signedUrl;
  const canViewApproved = (isHr || isSuperAdmin) && currentVideo?.status === "approved" && currentVideo.signedUrl;

  return (
    <section className="shrink-0 border-b border-white/[0.06] bg-[#0b0b10]/50 px-3 py-3 backdrop-blur-md sm:px-4 lg:px-6">
      <div className="mx-auto grid max-w-6xl gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-white">Candidate Verification Video</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                {isLoadingState ? "Checking video state..." : videoState?.interviewId ? "Attached to active interview" : "Available once HR joins"}
              </p>
            </div>
            {currentVideo && (
              <span className="w-fit rounded-md border border-indigo-500/20 bg-indigo-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                {currentVideo.status.replace("_", " ")}
              </span>
            )}
          </div>

          {message && (
            <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-xs text-gray-300">
              {message}
            </div>
          )}

          {showCandidateUpload && (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/webm,video/mp4"
                className="hidden"
                onChange={(event) => void handleCandidateFile(event.target.files?.[0] || null)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-indigo-500"
              >
                Upload Verification Video
              </button>
              <span className="text-xs text-gray-500">WebM or MP4, max 50 MB</span>
            </div>
          )}

          {isUploading && (
            <div className="mt-4 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3 text-xs text-indigo-200">
              Uploading video to secure storage...
            </div>
          )}

          {showPendingCandidateStatus && (
            <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-gray-400">
              {videoState?.reason}
            </div>
          )}

          {(canReview || canViewApproved) && (
            <div className="mt-4 space-y-3">
              <video src={currentVideo?.signedUrl || undefined} controls className="max-h-[320px] w-full rounded-lg bg-black" />
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span>{currentVideo?.fileName || "candidate-video"}</span>
                <span>{formatBytes(currentVideo?.fileSize)}</span>
              </div>
              {canReview && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void reviewVideo("approve")}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => void reviewVideo("dismiss")}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-bold text-red-300 transition hover:bg-red-500/20"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {isHr && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-white">HR Candidate Recording</h2>
                <p className="mt-0.5 text-xs text-gray-500">Records candidate audio and video only.</p>
              </div>
              <span className="rounded-md border border-white/[0.06] bg-black/20 px-2 py-1 text-[10px] font-bold uppercase text-gray-400">
                {recordingState}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {recordingState === "recording" ? (
                <button
                  type="button"
                  onClick={() => stopRecording(false)}
                  className="w-full rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs font-bold uppercase tracking-wider text-red-300 transition hover:bg-red-500/20"
                >
                  Stop Recording {formatTime(recordingSeconds)}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={recordingState === "preview" || recordingState === "saving"}
                  onClick={startRecording}
                  className="w-full rounded-xl bg-blue-600 px-4 py-3 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Record Candidate
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {recordingState === "preview" && previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0b0b10] p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white">Recording Preview</h2>
                <p className="text-xs text-gray-500">Save uploads it as an approved HR recording.</p>
              </div>
              <span className="text-xs text-gray-500">{formatTime(recordingSeconds)}</span>
            </div>
            <video src={previewUrl} controls className="max-h-[60vh] w-full rounded-xl bg-black" />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={discardPreview}
                className="rounded-lg border border-white/10 px-4 py-2 text-xs font-bold text-gray-300 transition hover:bg-white/5"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => void saveRecording()}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}