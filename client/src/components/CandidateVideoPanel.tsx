"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  layout?: "stacked" | "workspace";
}

const maxVideoBytes = 50 * 1024 * 1024;
const allowedMimeTypes = new Set(["video/webm", "video/mp4"]);
const storageBucketName = "candidate-videos";

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

function formatToIST(isoString?: string | null) {
  if (!isoString) return "";
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }) + " IST";
  } catch (err) {
    return isoString || "";
  }
}

function getSignedUploadUrl(upload: { path: string; token: string; signedUrl?: string }) {
  if (upload.signedUrl) return upload.signedUrl;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("Supabase URL is not configured.");
  return `${supabaseUrl}/storage/v1/object/upload/sign/${storageBucketName}/${upload.path}?token=${upload.token}`;
}

function uploadToSignedUrlWithProgress(
  upload: { path: string; token: string; signedUrl?: string },
  file: Blob,
  onProgress: (progress: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    const formData = new FormData();
    formData.append("cacheControl", "3600");
    formData.append("", file);

    const xhr = new XMLHttpRequest();
    xhr.open("PUT", getSignedUploadUrl(upload));
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`Storage upload failed (${xhr.status}): ${xhr.responseText || xhr.statusText}`));
      }
    };
    xhr.onerror = () => reject(new Error("Storage upload failed. Check your network and bucket settings."));
    xhr.send(formData);
  });
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
  layout = "stacked",
}: CandidateVideoPanelProps) {
  const [videoState, setVideoState] = useState<CandidateVideoState | null>(null);
  const [isLoadingState, setIsLoadingState] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<string | null>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [candidateUploadFile, setCandidateUploadFile] = useState<File | null>(null);
  const [candidateUploadPreviewUrl, setCandidateUploadPreviewUrl] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  const discardRecordingRef = useRef(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setIsMounted(true), 0);
    return () => window.clearTimeout(timeout);
  }, []);

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
    return () => window.clearTimeout(timeout);
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
      stopRecording(false);
      window.setTimeout(() => {
        setMessage("Candidate/HR disconnected from the call. Video recording stopped and finalized as a preview.");
      }, 0);
    }
  }, [recordingState, stopRecording, users]);

  const cancelUpload = useCallback(async (videoId: string) => {
    setMessage(null);
    try {
      await apiFetch(`/api/candidate-videos/${videoId}/cancel-upload`, { method: "POST" });
      setMessage("The in-progress upload was reset. You can upload again.");
      await refreshVideoState();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }, [apiFetch, refreshVideoState]);

  const clearCandidateUploadPreview = useCallback(() => {
    if (candidateUploadPreviewUrl) URL.revokeObjectURL(candidateUploadPreviewUrl);
    setCandidateUploadPreviewUrl(null);
    setCandidateUploadFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [candidateUploadPreviewUrl]);

  const handleCandidateFile = (file: File | null) => {
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

    if (candidateUploadPreviewUrl) URL.revokeObjectURL(candidateUploadPreviewUrl);
    setCandidateUploadFile(file);
    setCandidateUploadPreviewUrl(URL.createObjectURL(file));
    setMessage("Preview the selected video, then save it for HR review.");
  };

  const uploadSelectedCandidateFile = async () => {
    const file = candidateUploadFile;
    if (!file) return;

    setMessage(null);
    setIsUploading(true);
    setUploadProgress(0);
    setUploadPhase("Preparing upload...");
    let initializedVideoId: string | null = null;
    try {
      const init = await apiFetch("/api/candidate-videos/init-upload", {
        method: "POST",
        body: JSON.stringify({ roomId, fileName: file.name, mimeType: file.type, fileSize: file.size }),
      });
      initializedVideoId = init.video.id;
      setUploadPhase("Uploading to secure storage...");
      await uploadToSignedUrlWithProgress(init.upload, file, setUploadProgress);
      setUploadPhase("Finalizing upload...");
      await apiFetch(`/api/candidate-videos/${init.video.id}/complete-upload`, { method: "POST" });
      clearCandidateUploadPreview();
      setMessage("Verification video uploaded for HR review.");
      await refreshVideoState();
    } catch (err) {
      if (initializedVideoId) {
        try {
          await apiFetch(`/api/candidate-videos/${initializedVideoId}/cancel-upload`, { method: "POST" });
        } catch (cleanupErr) {
          console.warn("Could not clean up failed upload", cleanupErr);
        }
      }
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
      setUploadPhase(null);
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
      setUploadProgress(0);
      setUploadPhase("Saving recording...");
      await uploadToSignedUrlWithProgress(init.upload, recordingBlob, setUploadProgress);
      setUploadPhase("Finalizing recording...");
      await apiFetch(`/api/candidate-videos/${init.video.id}/complete-upload`, { method: "POST" });
      discardPreview();
      setRecordingState("saved");
      setMessage("Candidate recording saved. Pending HR review.");
      await refreshVideoState();
    } catch (err) {
      setRecordingState("preview");
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadPhase(null);
    }
  };
 
  if (!isCandidate && !isHr && !isSuperAdmin) return null;
 
  const currentVideo = videoState?.currentVideo;
  const isVerified = currentVideo?.status === "anr";
  const currentVideoCanReset = currentVideo?.source === "candidate_upload" && (currentVideo.status === "uploading" || currentVideo.status === "enr");
  const resettableVideo = videoState?.blockingVideo || (currentVideoCanReset ? currentVideo : null);
  const showCandidateUpload = isCandidate && videoState?.uploadAllowed && !isUploading && !isVerified;
  const showPendingCandidateStatus = isCandidate && !videoState?.uploadAllowed && videoState?.reason && !isVerified;
  const showHrEmptyStatus = isHr && videoState && !currentVideo && !resettableVideo && !isVerified;
  const canReview = isHr && currentVideo && currentVideo.status === "enr" && currentVideo.signedUrl;
  const canViewAttachedVideo = Boolean(currentVideo?.signedUrl && currentVideo.status !== "uploading" && (isCandidate || isHr || isSuperAdmin));
  const canResetUpload = Boolean((isCandidate || isHr) && resettableVideo && ["uploading", "enr"].includes(resettableVideo.status));
  const hasCandidateUploadPreview = Boolean(candidateUploadPreviewUrl && candidateUploadFile);
  const isWorkspaceLayout = layout === "workspace";

  const recordingPreviewModal = isMounted && (recordingState === "preview" || recordingState === "saving") && previewUrl
    ? createPortal(
        <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/90 p-3 sm:p-4">
          <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b10] shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
            <div className="shrink-0 border-b border-white/10 px-4 py-3 sm:px-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-white">Recording Preview</h2>
                  <p className="text-xs text-gray-500">Save uploads it as an approved HR recording.</p>
                </div>
                <span className="text-xs text-gray-500">{formatTime(recordingSeconds)}</span>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
              {message && (
                <div className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {message}
                </div>
              )}
              <video src={previewUrl} controls className="mx-auto max-h-[min(56dvh,520px)] w-full rounded-xl bg-black object-contain" />
            </div>
            <div className="shrink-0 border-t border-white/10 bg-[#0b0b10] px-4 py-3 sm:px-5">
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={discardPreview}
                  disabled={recordingState === "saving"}
                  className="rounded-lg border border-white/10 px-4 py-2 text-xs font-bold text-gray-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => void saveRecording()}
                  disabled={recordingState === "saving"}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {recordingState === "saving" ? `${uploadPhase || "Saving..."} ${uploadProgress}%` : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  const candidateUploadPreviewModal = isMounted && hasCandidateUploadPreview
    ? createPortal(
        <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/90 p-3 sm:p-4">
          <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b10] shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
            <div className="shrink-0 border-b border-white/10 px-4 py-3 sm:px-5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-white">Upload Preview</h2>
                  <p className="text-xs text-gray-500">Review the selected verification video before saving it.</p>
                </div>
                <span className="shrink-0 text-xs text-gray-500">{formatBytes(candidateUploadFile?.size)}</span>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
              {message && (
                <div className="mb-3 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-xs text-gray-300">
                  {message}
                </div>
              )}
              <video
                src={candidateUploadPreviewUrl || undefined}
                controls
                className="mx-auto max-h-[min(56dvh,520px)] w-full rounded-xl bg-black object-contain"
              />
              <div className="mt-3 truncate text-xs text-gray-500">{candidateUploadFile?.name}</div>
            </div>
            <div className="shrink-0 border-t border-white/10 bg-[#0b0b10] px-4 py-3 sm:px-5">
              {isUploading && (
                <div className="mb-3 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3 text-xs text-indigo-100">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span>{uploadPhase || "Uploading video..."}</span>
                    <span className="font-mono font-bold">{uploadProgress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-black/30">
                    <div className="h-full rounded-full bg-indigo-400 transition-all" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={clearCandidateUploadPreview}
                  disabled={isUploading}
                  className="rounded-lg border border-white/10 px-4 py-2 text-xs font-bold text-gray-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => void uploadSelectedCandidateFile()}
                  disabled={isUploading}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isUploading ? "Saving..." : "Save Upload"}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
    <section
      className={`shrink-0 border-b border-white/[0.06] bg-[#0b0b10]/50 px-3 py-3 backdrop-blur-md sm:px-4 lg:px-6 ${
        isWorkspaceLayout ? "lg:min-h-0 lg:border-b-0 lg:border-r lg:px-5" : ""
      }`}
    >
      <div
        className={
          isWorkspaceLayout
            ? "mx-auto flex max-w-6xl flex-col gap-3 lg:mx-0 lg:max-w-none"
            : "mx-auto grid max-w-6xl gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]"
        }
      >
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-white">Candidate Verification Video</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                {isLoadingState ? "Checking video state..." : isVerified ? "Verification complete" : "Verification in progress"}
              </p>
            </div>
            {currentVideo && (
              <span className={`w-fit rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                currentVideo.status === "anr"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                  : "border-indigo-500/20 bg-indigo-500/10 text-indigo-300"
              }`}>
                {currentVideo.status.replace("_", " ")}
              </span>
            )}
          </div>

          {message && (
            <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-xs text-gray-300">
              {message}
            </div>
          )}

          {isVerified && videoState?.verification && (
            <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-200 animate-fade-in">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-emerald-500/20 p-2 text-emerald-400">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">Approved & Verified</h3>
                  <p className="text-xs mt-0.5 text-emerald-300/85">
                    Verified By: <span className="font-semibold text-white">{videoState.verification.approvedByHrName || "HR"}</span>
                  </p>
                  <p className="text-[10px] mt-0.5 text-emerald-400/60">
                    Verified On: {formatToIST(videoState.verification.approvedAt)}
                  </p>
                </div>
              </div>
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

          {hasCandidateUploadPreview && (
            <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3 text-xs text-gray-400">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0 truncate">{candidateUploadFile?.name}</span>
                <span className="shrink-0 text-emerald-300">Preview open</span>
              </div>
            </div>
          )}
          {isUploading && !hasCandidateUploadPreview && (
            <div className="mt-4 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3 text-xs text-indigo-100">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span>{uploadPhase || "Uploading video..."}</span>
                <span className="font-mono font-bold">{uploadProgress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-black/30">
                <div className="h-full rounded-full bg-indigo-400 transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          {canResetUpload && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Are you sure you want to reset the current video upload?")) {
                  resettableVideo && void cancelUpload(resettableVideo.id);
                }
              }}
              className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-200 transition hover:bg-amber-500/20"
            >
              Reset Upload
            </button>
          )}

          {showPendingCandidateStatus && (
            <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-gray-400">
              {videoState?.reason}
            </div>
          )}

          {showHrEmptyStatus && (
            <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-gray-400">
              No candidate verification upload is attached yet.
            </div>
          )}

          {canViewAttachedVideo && (
            <div className="mt-4 space-y-3">
              <video
                src={currentVideo?.signedUrl || undefined}
                controls
                className={`w-full rounded-lg bg-black object-contain ${
                  isWorkspaceLayout ? "max-h-[320px] lg:max-h-[min(46dvh,360px)]" : "max-h-[320px]"
                }`}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span>{currentVideo?.fileName || (currentVideo?.source === "hr_recording" ? "hr-candidate-recording" : "candidate-verification-video")}</span>
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
                    onClick={() => {
                      if (window.confirm("Are you sure you want to dismiss this verification video?")) {
                        void reviewVideo("dismiss");
                      }
                    }}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-bold text-red-300 transition hover:bg-red-500/20"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {isHr && !isVerified && (
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
    </section>
    {recordingPreviewModal}
    {candidateUploadPreviewModal}
    </>
  );
}
