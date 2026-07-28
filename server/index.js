require("dotenv").config();

process.on("uncaughtException", (err) => {
  console.error("[CRITICAL] Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("[CRITICAL] Unhandled Rejection:", reason);
});

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const crypto = require("crypto");
const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
const { createClient: createDeepgramClient, LiveTranscriptionEvents } = require("@deepgram/sdk");

const supabaseAdmin = require("./supabase");
const {
  createRoom,
  normalizeLanguage,
  joinRoom,
  leaveRoom,
  getRoom,
  getAllRooms,
  getRoomsForRole,
  getProjectedRoomState,
  bumpRoomStateVersion,
  getRoomSocketsByRole,
  toggleMute,
  toggleVideo,
  setSpeaking,
  addBlock,
  updateBlockContent,
  findActiveSpeakerBlock,
  finalizeAllActiveSpeakers,
  findUserRoom,
  deleteRoom,
} = require("./rooms");

const app = express();
const server = http.createServer(app);

const deepgram = createDeepgramClient(process.env.DEEPGRAM_API_KEY);
const deepgramModel = process.env.DEEPGRAM_MODEL || "nova-3";
const deepgramLanguage = process.env.DEEPGRAM_LANGUAGE || "en-US";

if (!process.env.DEEPGRAM_API_KEY) {
  console.warn("[Deepgram] DEEPGRAM_API_KEY is not configured. Live transcription will fail until it is set.");
}

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => callback(null, true),
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(cors({
  origin: (origin, callback) => callback(null, true),
  credentials: true
}));
app.use(express.json());

const speakerTimeouts = new Map();
const activeDeepgramConnections = new Map(); // roomId -> { dgConnection, isDeepgramConnecting, isDgOpen, audioQueue }
const transcriptionCountdowns = new Map(); // roomId -> countdown interval
const hrRecoveryTimers = new Map(); // roomId → { timerId, tickId } — cancellable HR-disconnect recovery
const candidateRecoveryTimers = new Map(); // roomId → { timerId, tickId }
const abandonedRecoveryTimers = new Map(); // roomId → { timerId }
const allowedRoles = new Set(["candidate", "hr", "super_admin"]);
const activeUserSockets = new Map(); // Supabase auth user id -> active socket id
const candidateVideoBucket = "candidate-videos";
const maxCandidateVideoBytes = 50 * 1024 * 1024;
const allowedCandidateVideoMimes = new Set(["video/webm", "video/mp4"]);

function createAgoraUid(userId, roomId, role) {
  const hash = crypto.createHash("sha256").update(`${userId}:${roomId}:${role}`).digest();
  const uid = hash.readUInt32BE(0);
  return uid === 0 ? 1 : uid;
}

async function getAuthenticatedUserFromToken(token) {
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    throw error || new Error("Invalid session");
  }
  return user;
}

function getEmailPrefix(email, fallback = "User") {
  return email?.split("@")[0] || fallback;
}

async function getUserProfile(user) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role, display_name, language")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[Auth] Failed to fetch user profile:", error);
    throw new Error("Unable to verify user role");
  }

  const role = data?.role || "candidate";
  const displayName = data?.display_name?.trim() || getEmailPrefix(user.email);
  return {
    role: allowedRoles.has(role) ? role : "candidate",
    displayName,
    language: normalizeLanguage(data?.language),
  };
}

async function getAuthorizedRole(userId) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[Auth] Failed to fetch user role:", error);
    throw new Error("Unable to verify user role");
  }

  const role = data?.role || "candidate";
  return allowedRoles.has(role) ? role : "candidate";
}

function createInternalRoomId() {
  return `room-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

async function getDisplayNameForUserId(userId, fallback = "User") {
  if (!userId) return fallback;

  try {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("user_id", userId)
      .maybeSingle();

    if (data?.display_name?.trim()) return data.display_name.trim();
  } catch (err) {
    console.warn("[Profiles] Could not read display name:", err.message);
  }

  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    return getEmailPrefix(data?.user?.email, fallback);
  } catch (err) {
    return fallback;
  }
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.split(" ")[1];
}

async function getAuthenticatedRequestContext(req) {
  const token = getBearerToken(req);
  if (!token) {
    const err = new Error("No token provided");
    err.status = 401;
    throw err;
  }

  const user = await getAuthenticatedUserFromToken(token);
  const profile = await getUserProfile(user);
  return { user, profile };
}

function sendApiError(res, err, fallback = "Request failed") {
  const status = err.status || 500;
  if (status >= 500) console.error("[API Error]", err);
  return res.status(status).json({ error: err.message || fallback });
}

function assertAllowedCandidateVideoFile({ mimeType, fileSize }) {
  if (!allowedCandidateVideoMimes.has(mimeType)) {
    const err = new Error("Only WebM and MP4 videos are allowed.");
    err.status = 400;
    throw err;
  }

  const parsedSize = Number(fileSize);
  if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
    const err = new Error("A valid file size is required.");
    err.status = 400;
    throw err;
  }

  if (parsedSize > maxCandidateVideoBytes) {
    const err = new Error("Video must be 50 MB or smaller.");
    err.status = 413;
    throw err;
  }
}

function getVideoExtension(mimeType, fileName = "") {
  const lowerName = String(fileName || "").toLowerCase();
  if (mimeType === "video/mp4" || lowerName.endsWith(".mp4")) return "mp4";
  return "webm";
}

function getVideoStoragePath({ candidateUserId, source, videoId, mimeType, fileName }) {
  const folder = source === "hr_recording" ? "hr-recording" : "candidate-upload";
  const prefix = source === "hr_recording" ? "R_" : "U_";
  const extension = getVideoExtension(mimeType, fileName);
  return `${candidateUserId}/${folder}/${prefix}${videoId}.${extension}`;
}

function getEndedReason(reason) {
  if (reason === "hr-disconnect") return "hr_disconnect_timeout";
  if (reason === "candidate-left-before-hr") return "candidate_left_before_hr";
  if (reason === "candidate-disconnect") return "candidate_disconnect_timeout";
  if (reason === "system-error") return "system_error";
  return "hr_ended";
}

async function createOrReuseActiveInterview(roomId, hrSocket) {
  const room = getRoom(roomId);
  if (!room?.candidateUser || !room.hrUser) return null;

  const now = new Date().toISOString();
  const basePayload = {
    room_id: room.roomId,
    hr_user_id: room.hrUser.authUserId || hrSocket.data.userId,
    candidate_user_id: room.candidateUser.authUserId,
    status: "active",
    started_at: now,
    ended_at: null,
    updated_at: now,
  };
  const snapshotPayload = {
    ...basePayload,
    candidate_name_snapshot: room.candidateUser.name,
    hr_name_snapshot: room.hrUser.name,
    language: room.language,
    ended_reason: null,
  };

  if (!room.interviewSessionId) {
    let insertResult = await supabaseAdmin
      .from("interviews")
      .insert([snapshotPayload])
      .select()
      .single();

    if (insertResult.error && /candidate_name_snapshot|hr_name_snapshot|language|ended_reason/i.test(insertResult.error.message || "")) {
      insertResult = await supabaseAdmin
        .from("interviews")
        .insert([basePayload])
        .select()
        .single();
    }

    if (insertResult.error) throw insertResult.error;
    room.interviewSessionId = insertResult.data.id;
    room.state = "active";
    console.log(`[DB] Created interview session ${room.interviewSessionId} for room ${roomId}`);
    return insertResult.data;
  }

  let updateResult = await supabaseAdmin
    .from("interviews")
    .update(snapshotPayload)
    .eq("id", room.interviewSessionId)
    .select()
    .single();

  if (updateResult.error && /candidate_name_snapshot|hr_name_snapshot|language|ended_reason/i.test(updateResult.error.message || "")) {
    updateResult = await supabaseAdmin
      .from("interviews")
      .update(basePayload)
      .eq("id", room.interviewSessionId)
      .select()
      .single();
  }

  if (updateResult.error) throw updateResult.error;
  room.state = "active";
  return updateResult.data;
}

async function updateInterviewClosure(room, { status = "completed", reason = "hr_ended", finalTranscript = null } = {}) {
  if (!room?.interviewSessionId) return null;
  const now = new Date().toISOString();
  const payload = {
    status,
    ended_at: now,
    updated_at: now,
  };
  if (finalTranscript !== null) payload.final_transcript = finalTranscript;

  const snapshotPayload = { ...payload, ended_reason: reason };
  let result = await supabaseAdmin
    .from("interviews")
    .update(snapshotPayload)
    .eq("id", room.interviewSessionId)
    .select()
    .single();

  if (result.error && /ended_reason/i.test(result.error.message || "")) {
    result = await supabaseAdmin
      .from("interviews")
      .update(payload)
      .eq("id", room.interviewSessionId)
      .select()
      .single();
  }

  if (result.error) throw result.error;
  return result.data;
}

function getRoomByInterviewId(interviewId) {
  if (!interviewId) return null;
  for (const room of getAllRooms()) {
    const fullRoom = getRoom(room.roomId);
    if (fullRoom?.interviewSessionId === interviewId) return fullRoom;
  }
  return null;
}

function getRoomByCandidateId(candidateUserId) {
  if (!candidateUserId) return null;
  for (const room of getAllRooms()) {
    const fullRoom = getRoom(room.roomId);
    const roomCandidateId = fullRoom?.candidateUser?.authUserId || fullRoom?.lastCandidateUser?.authUserId;
    if (roomCandidateId === candidateUserId) {
      return fullRoom;
    }
  }
  return null;
}

function getRoomForCandidateVideoAction(video) {
  return getRoomByInterviewId(video?.interview_id) || getRoomByCandidateId(video?.candidate_user_id);
}

function getRecoverableCandidateRoom(candidateUserId) {
  if (!candidateUserId) return null;

  const recoverableStates = new Set(["candidate_recovering", "waiting_for_candidate"]);
  const candidates = [];

  for (const summary of getAllRooms()) {
    const room = getRoom(summary.roomId);
    if (!room) continue;

    const roomCandidateId = room.candidateUser?.authUserId || room.lastCandidateUser?.authUserId;
    if (roomCandidateId !== candidateUserId) continue;
    if (!recoverableStates.has(room.state)) continue;
    if (!room.hrUser) continue;
    if (room.candidateUser && room.candidateUser.authUserId !== candidateUserId) continue;

    candidates.push(room);
  }

  candidates.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return candidates[0] || null;
}

function assertRoomParticipant(room, userId, role) {
  if (!room) {
    const err = new Error("Room is no longer active.");
    err.status = 404;
    throw err;
  }

  if (role === "candidate" && room.candidateUser?.authUserId !== userId) {
    const err = new Error("Candidate access required for this interview.");
    err.status = 403;
    throw err;
  }

  if (role === "hr" && room.hrUser?.authUserId !== userId) {
    const err = new Error("Assigned HR access required for this interview.");
    err.status = 403;
    throw err;
  }
}

async function createSignedVideoUrl(video) {
  if (!video?.storage_path) return null;
  const { data, error } = await supabaseAdmin.storage
    .from(video.storage_bucket || candidateVideoBucket)
    .createSignedUrl(video.storage_path, 60 * 60);
  if (error) throw error;
  return data?.signedUrl || null;
}

function mapVideoForClient(video, signedUrl = null) {
  if (!video) return null;
  return {
    id: video.id,
    candidateUserId: video.candidate_user_id,
    hrUserId: video.hr_user_id,
    interviewId: video.interview_id,
    source: video.source,
    status: video.status,
    storageBucket: video.storage_bucket,
    storagePath: video.storage_path,
    fileName: video.file_name,
    mimeType: video.mime_type,
    fileSize: video.file_size,
    durationSeconds: video.duration_seconds,
    approvedByUserId: video.approved_by_hr_user_id || video.hr_user_id,
    approvedAt: video.approved_at,
    dismissedAt: video.dismissed_at,
    createdAt: video.created_at,
    updatedAt: video.updated_at,
    signedUrl,
  };
}

async function buildCandidateVideoState(room, requestor) {
  const candidateUserId = room?.candidateUser?.authUserId || room?.lastCandidateUser?.authUserId;
  if (!candidateUserId) {
    return {
      interviewId: room?.interviewSessionId || null,
      uploadAllowed: false,
      reason: "No candidate found in the room.",
      currentVideo: null,
      blockingVideo: null,
    };
  }

  // 1. Check candidate_verification for the candidate
  const { data: verification, error: verError } = await supabaseAdmin
    .from("candidate_verification")
    .select("*")
    .eq("candidate_user_id", candidateUserId)
    .eq("is_active", true)
    .maybeSingle();

  if (verError) throw verError;

  let displayVideo = null;
  let uploadAllowed = true;
  let reason = null;
  let verificationInfo = null;

  if (verification) {
    // Finalized verification exists
    const { data: video, error: videoError } = await supabaseAdmin
      .from("candidate_videos")
      .select("*")
      .eq("id", verification.video_id)
      .single();

    if (videoError) throw videoError;
    displayVideo = video;
    uploadAllowed = false;
    reason = "Candidate verification is already approved.";
    verificationInfo = {
      approvedByHrName: verification.approved_by_hr_name_snapshot,
      approvedAt: verification.approved_at,
    };
  } else {
    // 2. Fetch latest candidate_videos record where status = 'enr' order by created_at desc limit 1
    const { data: enrVideos, error: enrError } = await supabaseAdmin
      .from("candidate_videos")
      .select("*")
      .eq("candidate_user_id", candidateUserId)
      .eq("status", "enr")
      .order("created_at", { ascending: false })
      .limit(1);

    if (enrError) throw enrError;

    const latestEnrVideo = enrVideos?.[0] || null;

    if (latestEnrVideo) {
      displayVideo = latestEnrVideo;
      uploadAllowed = false;
      reason = "Your uploaded video is pending HR review.";
    } else {
      // 3. Check for any record in 'uploading' state for the candidate
      const { data: uploadingVideos, error: uploadingError } = await supabaseAdmin
        .from("candidate_videos")
        .select("*")
        .eq("candidate_user_id", candidateUserId)
        .eq("status", "uploading")
        .order("created_at", { ascending: false })
        .limit(1);

      if (uploadingError) throw uploadingError;
      const latestUploadingVideo = uploadingVideos?.[0] || null;

      if (latestUploadingVideo) {
        displayVideo = latestUploadingVideo;
        uploadAllowed = false;
        reason = "A video upload is already in progress.";
      } else {
        uploadAllowed = true;
        reason = null;
      }
    }
  }

  // 4. Enforce room and role restrictions if upload is otherwise allowed
  if (uploadAllowed) {
    if (!room?.interviewSessionId) {
      uploadAllowed = false;
      reason = "Upload is available after HR joins the call.";
    } else if (!room.hrUser) {
      uploadAllowed = false;
      reason = "Upload is available only while HR is present.";
    } else if (requestor.role !== "candidate") {
      uploadAllowed = false;
      reason = "Only the candidate can upload verification videos.";
    } else if (room.candidateUser?.authUserId !== requestor.userId) {
      uploadAllowed = false;
      reason = "This interview belongs to another candidate.";
    }
  }

  const canViewVideo = requestor.role === "super_admin" || requestor.role === "hr" ||
    (requestor.role === "candidate" && candidateUserId === requestor.userId);

  let signedUrl = null;
  if (canViewVideo && displayVideo && displayVideo.status !== "uploading") {
    try {
      signedUrl = await createSignedVideoUrl(displayVideo);
    } catch (err) {
      console.warn("[CandidateVideo] Could not create signed playback URL:", err.message);
    }
  }

  const isResettable = displayVideo && ["uploading", "enr"].includes(displayVideo.status);
  const resettableUpload = isResettable ? displayVideo : null;

  return {
    interviewId: room?.interviewSessionId || null,
    uploadAllowed,
    reason,
    currentVideo: mapVideoForClient(displayVideo, signedUrl),
    blockingVideo: resettableUpload ? mapVideoForClient(resettableUpload) : null,
    verification: verificationInfo,
  };
}

async function buildCandidatePortfolio(candidateUserId) {
  const emptyState = {
    portfolioReady: false,
    reason: "Candidate portfolio is not ready yet.",
    verification: null,
    video: null,
    transcript: null,
  };

  const { data: verification, error: verError } = await supabaseAdmin
    .from("candidate_verification")
    .select("*")
    .eq("candidate_user_id", candidateUserId)
    .eq("is_active", true)
    .maybeSingle();

  if (verError) throw verError;
  if (!verification) {
    return {
      ...emptyState,
      reason: "Candidate verification has not been approved yet.",
    };
  }

  const { data: video, error: videoError } = await supabaseAdmin
    .from("candidate_videos")
    .select("*")
    .eq("id", verification.video_id)
    .single();

  if (videoError) throw videoError;

  let interview = null;
  if (video?.interview_id) {
    const { data, error } = await supabaseAdmin
      .from("interviews")
      .select("id, room_id, hr_user_id, candidate_user_id, candidate_name_snapshot, hr_name_snapshot, status, ended_reason, final_transcript, started_at, ended_at")
      .eq("id", video.interview_id)
      .maybeSingle();
    if (error) throw error;
    interview = data;
  }

  if (!interview) {
    const { data, error } = await supabaseAdmin
      .from("interviews")
      .select("id, room_id, hr_user_id, candidate_user_id, candidate_name_snapshot, hr_name_snapshot, status, ended_reason, final_transcript, started_at, ended_at")
      .eq("candidate_user_id", candidateUserId)
      .eq("status", "completed")
      .eq("ended_reason", "hr_ended")
      .order("ended_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    interview = data;
  }

  const wasAdjournedByHr =
    interview?.status === "completed" &&
    interview?.ended_reason === "hr_ended";

  if (!wasAdjournedByHr) {
    return {
      ...emptyState,
      reason: "Verification was approved, but the interview was not adjourned by HR.",
      verification: {
        approvedByHrName: verification.approved_by_hr_name_snapshot,
        approvedAt: verification.approved_at,
      },
    };
  }

  let signedUrl = null;
  try {
    signedUrl = await createSignedVideoUrl(video);
  } catch (err) {
    console.warn("[CandidatePortfolio] Could not create signed playback URL:", err.message);
  }

  return {
    portfolioReady: true,
    reason: null,
    verification: {
      approvedByHrName: verification.approved_by_hr_name_snapshot,
      approvedAt: verification.approved_at,
    },
    video: mapVideoForClient(video, signedUrl),
    transcript: {
      interviewId: interview.id,
      content: interview.final_transcript || "",
      savedAt: interview.ended_at,
      hrName: interview.hr_name_snapshot || verification.approved_by_hr_name_snapshot || "HR",
      candidateName: interview.candidate_name_snapshot || null,
    },
  };
}

async function rollbackUnadjournedVerification(room) {
  const candidateUser = room?.candidateUser || room?.lastCandidateUser;
  if (!candidateUser?.authUserId || !room?.interviewSessionId) return;

  const { data: verification, error: verError } = await supabaseAdmin
    .from("candidate_verification")
    .select("candidate_user_id, video_id")
    .eq("candidate_user_id", candidateUser.authUserId)
    .eq("is_active", true)
    .maybeSingle();

  if (verError) throw verError;
  if (!verification?.video_id) return;

  const { data: video, error: videoError } = await supabaseAdmin
    .from("candidate_videos")
    .select("id, interview_id, status")
    .eq("id", verification.video_id)
    .maybeSingle();

  if (videoError) throw videoError;
  if (video?.interview_id !== room.interviewSessionId || video.status !== "anr") return;

  const now = new Date().toISOString();
  const deleteResult = await supabaseAdmin
    .from("candidate_verification")
    .delete()
    .eq("candidate_user_id", candidateUser.authUserId);
  if (deleteResult.error) throw deleteResult.error;

  const updateResult = await supabaseAdmin
    .from("candidate_videos")
    .update({ status: "archived", updated_at: now, dismissed_at: now })
    .eq("id", verification.video_id);
  if (updateResult.error) throw updateResult.error;
}

async function emitCandidateVideoState(roomId) {
  const room = getRoom(roomId);
  if (!room) return;
  const { regular, superAdmin } = getRoomSocketsByRole(roomId);
  [...regular, ...superAdmin].forEach((socketId) => {
    io.to(socketId).emit("candidate-video-updated", { roomId });
  });
}

// Helper to broadcast projected room state based on roles
const broadcastProjectedRoomState = (roomId) => {
  if (!roomId) return;
  bumpRoomStateVersion(roomId);
  const { regular, superAdmin } = getRoomSocketsByRole(roomId);
  
  // Broadcast to Regular users (Candidate, HR) - no hidden observers
  const regularState = getProjectedRoomState(roomId, "candidate");
  if (regularState) {
    regular.forEach(socketId => {
      io.to(socketId).emit("room-state", regularState);
    });
  }

  // Broadcast to Super Admins - sees everyone
  const adminState = getProjectedRoomState(roomId, "super_admin");
  if (adminState) {
    superAdmin.forEach(socketId => {
      io.to(socketId).emit("room-state", adminState);
    });
  }
};

function isSocketInRoom(socket, roomId) {
  return Boolean(roomId && socket.data.roomId === roomId);
}

function canManageTranscript(socket) {
  return socket.data.role === "hr" || socket.data.role === "candidate";
}

function clearCountdown(roomId) {
  const interval = transcriptionCountdowns.get(roomId);
  if (interval) {
    clearInterval(interval);
    transcriptionCountdowns.delete(roomId);
  }
}

function clearSpeakerTimeouts(roomId) {
  const prefix = `${roomId}-`;
  for (const [key, timeout] of speakerTimeouts) {
    if (key.startsWith(prefix)) {
      clearTimeout(timeout);
      speakerTimeouts.delete(key);
    }
  }
}

function closeDeepgramForRoom(roomId, expectedConnection = null) {
  const dgState = activeDeepgramConnections.get(roomId);
  if (!dgState) return;
  if (expectedConnection && dgState.dgConnection !== expectedConnection) return;

  if (dgState.dgConnection) {
    try { dgState.dgConnection.requestClose(); } catch (e) {}
  }
  dgState.dgConnection = null;
  dgState.isDeepgramConnecting = false;
  dgState.isDgOpen = false;
  dgState.audioQueue = [];
  activeDeepgramConnections.delete(roomId);
}

function stopTranscriptionForRoom(roomId, { emitStopped = true } = {}) {
  const room = getRoom(roomId);
  if (!room) return false;

  clearCountdown(roomId);
  room.state = "paused";
  room.activeTranscriptionSession.isActive = false;
  room.activeTranscriptionSession.startedAt = null;
  finalizeAllActiveSpeakers(roomId);
  closeDeepgramForRoom(roomId);
  clearSpeakerTimeouts(roomId);

  if (emitStopped) io.to(roomId).emit("transcription-stopped");
  broadcastProjectedRoomState(roomId);
  return true;
}

function markTranscriptionUnavailable(roomId, message = "Live transcription is unavailable. Please try starting transcription again.") {
  const room = getRoom(roomId);
  if (!room) return;

  clearCountdown(roomId);
  room.state = "paused";
  room.activeTranscriptionSession.isActive = false;
  room.activeTranscriptionSession.startedAt = null;
  finalizeAllActiveSpeakers(roomId);
  clearSpeakerTimeouts(roomId);

  io.to(roomId).emit("transcription-stopped");
  io.to(roomId).emit("transcript-save-error", message);
  broadcastProjectedRoomState(roomId);
}

// ─────────────────────────────────────────────────────────────────────────────
// HR RECOVERY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * enterHrRecoveryMode — called when the active HR socket disconnects unexpectedly.
 * Puts the room in "hr_recovering" state and starts a 15-second countdown.
 * The room stays alive; the candidate stays in it; any available HR can rescue it.
 */
function enterHrRecoveryMode(roomId, hrSocket) {
  const room = getRoom(roomId);
  if (!room) return;

  const now = Date.now();
  const RECOVERY_MS = 15_000;

  room.state = "hr_recovering";
  room.priority = "critical";
  room.hrRecovery.isRecovering = true;
  room.hrRecovery.disconnectedAt = now;
  room.hrRecovery.deadline = now + RECOVERY_MS;
  room.hrRecovery.disconnectedHrAuthUserId = hrSocket?.data?.userId || null;
  room.hrRecovery.disconnectedHrName = hrSocket?.data?.displayName || hrSocket?.data?.userName || "HR";

  // Remove HR from active slot but keep room alive
  if (hrSocket?.id && hrSocket?.leave) {
    leaveRoom(roomId, hrSocket.id);
    hrSocket.leave(roomId);
  }

  // Stop any live transcription so Deepgram doesn't leak
  if (room.activeTranscriptionSession?.isActive || transcriptionCountdowns.has(roomId)) {
    stopTranscriptionForRoom(roomId, { emitStopped: false });
    // Override the state that stopTranscription set back to "paused"
    room.state = "hr_recovering";
  }

  broadcastProjectedRoomState(roomId);

  // Notify candidate (and super admins still in the room)
  io.to(roomId).emit("hr-recovering", {
    message: "Your interviewer has disconnected. Please wait — we're finding an interviewer for you.",
    deadline: room.hrRecovery.deadline,
    remainingMs: RECOVERY_MS,
  });

  broadcastProjectedRoomState(roomId);

  // Tick every second so the candidate sees a live countdown
  let remaining = Math.ceil(RECOVERY_MS / 1000);
  const tickId = setInterval(() => {
    remaining--;
    const liveRoom = getRoom(roomId);
    if (!liveRoom || !liveRoom.hrRecovery.isRecovering) {
      clearInterval(tickId);
      return;
    }
    io.to(roomId).emit("hr-recovery-tick", { remainingMs: Math.max(0, remaining * 1000) });
    if (remaining <= 0) clearInterval(tickId);
  }, 1_000);

  const timerId = setTimeout(async () => {
    clearInterval(tickId);
    hrRecoveryTimers.delete(roomId);
    const liveRoom = getRoom(roomId);
    if (!liveRoom) return; // Already cleaned up
    if (liveRoom.hrUser) {
      // HR rejoined just before timer fired
      console.log(`[Recovery] Timer fired for ${roomId} but HR is already back. No teardown.`);
      return;
    }
    console.log(`[Recovery] 15s expired for room ${roomId} with no HR. Running teardown.`);
    await executeFinalTeardown(roomId, hrSocket, { reason: "hr-disconnect", intentional: false });
  }, RECOVERY_MS);

  hrRecoveryTimers.set(roomId, { timerId, tickId });
  console.log(`[Recovery] Room ${roomId} entered hr_recovering. 15s window open. Any HR can rescue.`);
}

/**
 * cancelHrRecovery — called when any HR joins the recovering room.
 * Clears the countdown, resets recovery metadata, returns room to active state.
 */
function cancelHrRecovery(roomId) {
  const recovery = hrRecoveryTimers.get(roomId);
  if (recovery) {
    clearTimeout(recovery.timerId);
    clearInterval(recovery.tickId);
    hrRecoveryTimers.delete(roomId);
  }

  const room = getRoom(roomId);
  if (room) {
    room.state = "active";
    room.priority = "normal";
    room.hrRecovery.isRecovering = false;
    room.hrRecovery.disconnectedAt = null;
    room.hrRecovery.deadline = null;
    room.hrRecovery.disconnectedHrAuthUserId = null;
    // Keep disconnectedHrName for audit — cleared separately if needed
  }
  console.log(`[Recovery] HR recovery cancelled for room ${roomId}.`);
}

function enterCandidateRecoveryMode(roomId, candidateSocket) {
  const room = getRoom(roomId);
  if (!room) return;
  const now = Date.now();
  const RECOVERY_MS = 60_000;
  room.state = "candidate_recovering";
  room.candidateRecovery.isRecovering = true;
  room.candidateRecovery.disconnectedAt = now;
  room.candidateRecovery.deadline = now + RECOVERY_MS;
  room.candidateRecovery.disconnectedCandidateAuthUserId = candidateSocket?.data?.userId || null;
  room.candidateRecovery.disconnectedCandidateName = candidateSocket?.data?.displayName || candidateSocket?.data?.userName || "Candidate";

  if (candidateSocket?.id && candidateSocket?.leave) {
    leaveRoom(roomId, candidateSocket.id);
    candidateSocket.leave(roomId);
  }

  if (room.activeTranscriptionSession?.isActive || transcriptionCountdowns.has(roomId)) {
    stopTranscriptionForRoom(roomId, { emitStopped: false });
    room.state = "candidate_recovering";
  }

  broadcastProjectedRoomState(roomId);

  io.to(roomId).emit("candidate-recovering", {
    message: "Candidate has disconnected. Waiting for them to reconnect...",
    deadline: room.candidateRecovery.deadline,
    remainingMs: RECOVERY_MS,
  });

  let remaining = Math.ceil(RECOVERY_MS / 1000);
  const tickId = setInterval(() => {
    const fresh = getRoom(roomId);
    if (!fresh || !fresh.candidateRecovery.isRecovering) {
      clearInterval(tickId);
      return;
    }
    remaining = Math.max(0, Math.ceil((fresh.candidateRecovery.deadline - Date.now()) / 1000));
    io.to(roomId).emit("candidate-recovery-tick", {
      remainingMs: Math.max(0, fresh.candidateRecovery.deadline - Date.now()),
    });
    if (remaining <= 0) clearInterval(tickId);
  }, 1000);

  const timerId = setTimeout(() => {
    clearInterval(tickId);
    candidateRecoveryTimers.delete(roomId);
    const fresh = getRoom(roomId);
    if (fresh) {
      fresh.candidateRecovery.isRecovering = false;
      io.to(roomId).emit("candidate-recovery-timeout");
      broadcastProjectedRoomState(roomId);
      console.log(`[Recovery] Candidate recovery timeout for room ${roomId}. Prompting HR for decision.`);
    }
  }, RECOVERY_MS);

  candidateRecoveryTimers.set(roomId, { timerId, tickId });
  console.log(`[Recovery] Room ${roomId} entered candidate_recovering. 60s window open.`);
}

function cancelCandidateRecovery(roomId) {
  const recovery = candidateRecoveryTimers.get(roomId);
  if (recovery) {
    clearTimeout(recovery.timerId);
    clearInterval(recovery.tickId);
    candidateRecoveryTimers.delete(roomId);
  }
  const room = getRoom(roomId);
  if (room && room.candidateRecovery) {
    room.state = "active";
    room.candidateRecovery.isRecovering = false;
    room.candidateRecovery.isTimeout = false;
    room.candidateRecovery.disconnectedAt = null;
    room.candidateRecovery.deadline = null;
    room.candidateRecovery.disconnectedCandidateAuthUserId = null;
  }
  console.log(`[Recovery] Candidate recovery cancelled for room ${roomId}.`);
}

function enterAbandonedMode(roomId) {
  const room = getRoom(roomId);
  if (!room) return;
  const now = Date.now();
  const RECOVERY_MS = 5_000;
  room.state = "abandoned";
  room.priority = "critical";
  room.abandonedRecovery.isAbandoned = true;
  room.abandonedRecovery.abandonedAt = now;
  room.abandonedRecovery.deadline = now + RECOVERY_MS;

  if (room.activeTranscriptionSession?.isActive || transcriptionCountdowns.has(roomId)) {
    stopTranscriptionForRoom(roomId, { emitStopped: false });
    room.state = "abandoned";
  }

  // Cancel any existing HR or Candidate recovery timers because the room is completely empty
  const hrRec = hrRecoveryTimers.get(roomId);
  if (hrRec) {
    clearTimeout(hrRec.timerId);
    clearInterval(hrRec.tickId);
    hrRecoveryTimers.delete(roomId);
  }
  const candRec = candidateRecoveryTimers.get(roomId);
  if (candRec) {
    clearTimeout(candRec.timerId);
    clearInterval(candRec.tickId);
    candidateRecoveryTimers.delete(roomId);
  }

  broadcastProjectedRoomState(roomId);

  const timerId = setTimeout(async () => {
    abandonedRecoveryTimers.delete(roomId);
    console.log(`[Recovery] Abandoned timeout popped for room ${roomId}. Teardown initiated.`);
    // Create a dummy socket-like object to pass to executeFinalTeardown if needed
    const dummySocket = { data: { role: "system" } };
    await executeFinalTeardown(roomId, dummySocket, { reason: "abandoned", intentional: false });
  }, RECOVERY_MS);

  abandonedRecoveryTimers.set(roomId, { timerId });
  console.log(`[Recovery] Room ${roomId} is abandoned. 5s window open.`);
}

function cancelAbandonedMode(roomId) {
  const recovery = abandonedRecoveryTimers.get(roomId);
  if (recovery) {
    clearTimeout(recovery.timerId);
    abandonedRecoveryTimers.delete(roomId);
  }
  const room = getRoom(roomId);
  if (room) {
    room.abandonedRecovery.isAbandoned = false;
    room.abandonedRecovery.abandonedAt = null;
    room.abandonedRecovery.deadline = null;
  }
  console.log(`[Recovery] Abandoned mode cancelled for room ${roomId}.`);
}

/**
 * executeFinalTeardown — single authoritative teardown function.
 * Called by the recovery timer (unexpected) or end-interview (intentional).
 *
 * Fixes the completed-vs-cancelled status conflict:
 * - intentional=true  → status "completed",  reason "hr_ended"
 * - intentional=false → status "cancelled",   reason "hr_disconnect_timeout"
 * persistRoomTranscript now accepts a status param so it does NOT write
 * "completed" and then get overwritten by updateInterviewClosure.
 */
async function executeFinalTeardown(roomId, lastHrSocket, { reason = "hr-disconnect", intentional = false } = {}) {
  const room = getRoom(roomId);
  if (!room) return;

  // Cancel any running recovery timers
  const pending = hrRecoveryTimers.get(roomId);
  if (pending) {
    clearTimeout(pending.timerId);
    clearInterval(pending.tickId);
    hrRecoveryTimers.delete(roomId);
  }

  clearCountdown(roomId);
  closeDeepgramForRoom(roomId);
  clearSpeakerTimeouts(roomId);

  const closedStatus = intentional ? "completed" : "cancelled";
  const closedReason = intentional ? "hr_ended" : "hr_disconnect_timeout";
  const closedMessage = intentional
    ? "The interview has ended."
    : "The interviewer did not reconnect in time. The session has closed.";

  io.to(roomId).emit("hr-recording-state", { roomId, isRecording: false });
  io.to(roomId).emit("room-closed", closedMessage);

  const hasTranscript = (room.blocks || []).some(b => (b.content || "").trim());
  const hasCandidate = room.candidateUser || room.lastCandidateUser;

  try {
    if (hasTranscript && hasCandidate) {
      // persistRoomTranscript now takes a status param — no double-write
      await persistRoomTranscript(room, {
        savedByUserId: lastHrSocket.data.userId,
        reason,
        status: closedStatus,
        endedReason: closedReason,
      });
    } else {
      await updateInterviewClosure(room, {
        status: closedStatus,
        reason: closedReason,
        finalTranscript: "",
      });
    }
    if (!intentional) {
      await rollbackUnadjournedVerification(room);
    }
  } catch (err) {
    console.error("[DB Error] executeFinalTeardown persistence failed:", err);
  }

  // Evict all remaining sockets
  const { regular, superAdmin } = getRoomSocketsByRole(roomId);
  [...regular, ...superAdmin].forEach(sid => {
    const s = io.sockets.sockets.get(sid);
    if (s) { s.leave(roomId); if (s.data) s.data.roomId = null; }
  });

  deleteRoom(roomId);
  console.log(`[Teardown] Room ${roomId} fully cleaned up. intentional=${intentional}`);
}

function getCandidateTranscriptBlocks(room) {
  const candidateName = room?.candidateUser?.name || room?.lastCandidateUser?.name;
  return (room?.blocks || []).filter((block) => {
    const content = (block.content || "").trim();
    return content && (block.speakerRole === "candidate" || block.speakerName === candidateName);
  });
}

function buildFinalTranscript(room) {
  return getCandidateTranscriptBlocks(room)
    .map((block) => (block.content || "").trim())
    .filter(Boolean)
    .join(" ");
}

function toIsoFromMillis(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function mapFinalTranscriptForInsert(room, interviewId, finalTranscript) {
  const candidateUser = room.candidateUser || room.lastCandidateUser;
  const candidateBlocks = getCandidateTranscriptBlocks(room);
  const startedAt = candidateBlocks[0]?.createdAt ? toIsoFromMillis(candidateBlocks[0].createdAt) : new Date().toISOString();
  const endedAt = candidateBlocks[candidateBlocks.length - 1]?.updatedAt
    ? toIsoFromMillis(candidateBlocks[candidateBlocks.length - 1].updatedAt)
    : new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    interview_id: interviewId,
    speaker: candidateUser?.name || "Candidate",
    speaker_user_id: candidateUser?.authUserId || null,
    content: finalTranscript,
    confidence: 1.0,
    version: candidateBlocks.reduce((max, block) => Math.max(max, block.version || 1), 1),
    started_at: startedAt,
    ended_at: endedAt
  };
}

async function persistRoomTranscript(room, { savedByUserId, reason = "manual", status = "completed", endedReason = "hr_ended" } = {}) {
  const candidateUser = room?.candidateUser || room?.lastCandidateUser;
  if (!candidateUser?.authUserId) {
    throw new Error("Cannot persist transcript without a candidate user");
  }

  finalizeAllActiveSpeakers(room.roomId);

  const candidateUserId = candidateUser.authUserId;
  const hrUserId = room.hrUser?.authUserId || room.lastHrUser?.authUserId || savedByUserId || null;
  const finalTranscript = buildFinalTranscript(room);
  const now = new Date().toISOString();

  // Build update payload — status and endedReason are caller-controlled
  // to avoid the completed-vs-cancelled double-write conflict.
  const basePayload = {
    room_id: room.roomId,
    hr_user_id: hrUserId,
    candidate_user_id: candidateUserId,
    status,
    ended_at: now,
    final_transcript: finalTranscript,
  };

  if (!room.interviewSessionId) {
    let insertPayload = { ...basePayload, started_at: now };

    // Try with ended_reason column first; fall back if column doesn't exist
    let result = await supabaseAdmin
      .from("interviews")
      .insert([{ ...insertPayload, ended_reason: endedReason }])
      .select()
      .single();

    if (result.error && /ended_reason/i.test(result.error.message || "")) {
      result = await supabaseAdmin
        .from("interviews")
        .insert([insertPayload])
        .select()
        .single();
    }

    if (result.error) throw result.error;
    room.interviewSessionId = result.data.id;
  } else {
    let result = await supabaseAdmin
      .from("interviews")
      .update({ ...basePayload, ended_reason: endedReason })
      .eq("id", room.interviewSessionId);

    if (result.error && /ended_reason/i.test(result.error.message || "")) {
      result = await supabaseAdmin
        .from("interviews")
        .update(basePayload)
        .eq("id", room.interviewSessionId);
    }

    if (result.error) throw result.error;
  }

  const deleteResult = await supabaseAdmin
    .from("transcript_blocks")
    .delete()
    .eq("interview_id", room.interviewSessionId);

  if (deleteResult.error) throw deleteResult.error;

  const formattedBlocks = finalTranscript.trim()
    ? [mapFinalTranscriptForInsert(room, room.interviewSessionId, finalTranscript)]
    : [];

  if (formattedBlocks.length > 0) {
    const { error } = await supabaseAdmin.from("transcript_blocks").insert(formattedBlocks);
    if (error) throw error;
  }

  console.log(`[DB] Persisted transcript ${room.interviewSessionId} for candidate ${candidateUserId} (${reason}, status=${status})`);
  return {
    interviewId: room.interviewSessionId,
    savedAt: now,
    blockCount: formattedBlocks.length,
  };
}


async function loadLatestCandidateTranscript(candidateAuthUserId, currentInterviewId) {
  if (!candidateAuthUserId) return null;

  let query = supabaseAdmin
    .from("interviews")
    .select("id, hr_user_id, candidate_user_id, ended_at, started_at, final_transcript, status")
    .eq("candidate_user_id", candidateAuthUserId)
    .not("final_transcript", "is", null)
    .order("ended_at", { ascending: false, nullsFirst: false })
    .limit(1);

  if (currentInterviewId) {
    query = query.neq("id", currentInterviewId);
  }

  const { data: interviews, error } = await query;
  if (error) throw error;

  const interview = interviews?.[0];
  if (!interview) return null;

  const { data: storedBlocks, error: blockError } = await supabaseAdmin
    .from("transcript_blocks")
    .select("id, speaker, content, confidence, version, started_at, ended_at")
    .eq("interview_id", interview.id)
    .order("started_at", { ascending: true });

  if (blockError) throw blockError;

  const sourceHrName = await getDisplayNameForUserId(interview.hr_user_id, "HR");
  const sourceSavedAt = interview.ended_at || interview.started_at || new Date().toISOString();
  const sourceMeta = {
    sourceInterviewId: interview.id,
    sourceSavedAt,
    sourceHrUserId: interview.hr_user_id,
    sourceHrName,
    restoredFromHistory: true,
  };

  if ((!storedBlocks || storedBlocks.length === 0) && !(interview.final_transcript || "").trim()) {
    return null;
  }

  const blocks = (storedBlocks || []).length > 0
    ? storedBlocks.map((block) => {
        const createdAt = block.started_at ? new Date(block.started_at).getTime() : Date.now();
        const updatedAt = block.ended_at ? new Date(block.ended_at).getTime() : createdAt;
        return {
          id: crypto.randomUUID(),
          speakerId: "",
          speakerName: block.speaker || "Candidate",
          speakerRole: "candidate",
          content: block.content || "",
          segments: [{
            text: block.content || "",
            isFinal: true,
            timestamp: updatedAt,
            confidence: block.confidence ?? 1.0,
          }],
          status: "final",
          isLive: false,
          isFinal: true,
          version: block.version || 1,
          createdAt,
          updatedAt,
          editableBy: [],
          roomId: "",
          ...sourceMeta,
        };
      })
    : [{
        id: crypto.randomUUID(),
        speakerId: "",
        speakerName: "Candidate",
        speakerRole: "candidate",
        content: interview.final_transcript || "",
        segments: [{
          text: interview.final_transcript || "",
          isFinal: true,
          timestamp: new Date(sourceSavedAt).getTime(),
          confidence: 1.0,
        }],
        status: "final",
        isLive: false,
        isFinal: true,
        version: 1,
        createdAt: new Date(sourceSavedAt).getTime(),
        updatedAt: new Date(sourceSavedAt).getTime(),
        editableBy: [],
        roomId: "",
        ...sourceMeta,
      }];

  return { interview, blocks, sourceMeta };
}

async function hydrateRoomWithLatestCandidateTranscript(roomId) {
  const room = getRoom(roomId);
  if (!room?.candidateUser || !room.hrUser || room.blocks.length > 0) return false;

  try {
    const latest = await loadLatestCandidateTranscript(room.candidateUser.authUserId, room.interviewSessionId);
    if (!latest?.blocks?.length) return false;

    room.blocks = latest.blocks.map((block) => ({
      ...block,
      speakerId: room.candidateUser.id,
      speakerName: room.candidateUser.name,
      editableBy: [room.candidateUser.name, room.hrUser.name].filter(Boolean),
      roomId,
    }));
    return true;
  } catch (err) {
    console.error("[DB Error] Failed to restore candidate transcript:", err);
    return false;
  }
}

// Socket Auth Middleware
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;

  if (!token) {
    return next(new Error("Authentication error: Token missing"));
  }
  
  try {
    const user = await getAuthenticatedUserFromToken(token);
    const { role: authorizedRole, displayName, language } = await getUserProfile(user);

    socket.data.userId = user.id; 
    socket.data.email = user.email;
    socket.data.role = authorizedRole;
    socket.data.displayName = displayName;
    socket.data.language = language;
    socket.data.authenticated = true;
    next();
  } catch (err) {
    console.error("[Socket] Auth error:", err.message);
    next(new Error("Authentication error: Invalid token"));
  }
});

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Live Room Server Running" });
});

app.get("/api/me", async (req, res) => {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const user = await getAuthenticatedUserFromToken(token);
    const { role, displayName, language } = await getUserProfile(user);
    res.json({ user: { id: user.id, email: user.email, role, displayName, language } });
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
});

app.get("/api/token", async (req, res) => {
  const channelName = req.query.channelName;
  if (!channelName) return res.status(400).json({ error: "channelName is required" });
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "No token provided" });

  let authorizedRole;
  let user;
  try {
    user = await getAuthenticatedUserFromToken(token);
    authorizedRole = (await getUserProfile(user)).role;
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }

  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;
  const tokenRoom = getRoom(channelName);
  if (!tokenRoom) return res.status(404).json({ error: "Room not found" });
  if (
    authorizedRole === "candidate" &&
    tokenRoom.candidateUser?.authUserId !== user.id &&
    tokenRoom.lastCandidateUser?.authUserId !== user.id
  ) {
    return res.status(403).json({ error: "Candidates must create their own waiting room" });
  }
  if (authorizedRole === "hr" && tokenRoom.language !== (await getUserProfile(user)).language) {
    return res.status(403).json({ error: "Room language does not match HR profile" });
  }
  if (authorizedRole === "hr" && tokenRoom.hrUser && tokenRoom.hrUser.authUserId !== user.id) {
    return res.status(403).json({ error: "Room already has an HR" });
  }
  if (authorizedRole === "super_admin" && (!tokenRoom.candidateUser || !tokenRoom.hrUser)) {
    return res.status(403).json({ error: "Super Admins can only observe full ongoing calls" });
  }
  
  const rtcRole = authorizedRole === "super_admin" ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;
  const uid = createAgoraUid(user.id, channelName, authorizedRole);
  const agoraToken = RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channelName, uid, rtcRole, Math.floor(Date.now() / 1000) + 3600);
  
  return res.json({ token: agoraToken, uid });
});

app.get("/api/rooms", async (req, res) => {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    const user = await getAuthenticatedUserFromToken(token);
    const profile = await getUserProfile(user);
    if (profile.role === "candidate") {
      return res.status(403).json({ error: "Room list access requires HR or Super Admin access" });
    }
    res.json({ rooms: getRoomsForRole(profile.role, profile.language) });
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
});

app.get("/api/candidate/recovery-room", async (req, res) => {
  try {
    const { user, profile } = await getAuthenticatedRequestContext(req);
    if (profile.role !== "candidate") {
      return res.status(403).json({ error: "Candidate recovery lookup requires Candidate access" });
    }

    const room = getRecoverableCandidateRoom(user.id);
    if (!room) {
      return res.json({ hasRecoveryRoom: false });
    }

    const remainingMs =
      room.candidateRecovery?.isRecovering && room.candidateRecovery.deadline
        ? Math.max(0, room.candidateRecovery.deadline - Date.now())
        : null;

    res.json({
      hasRecoveryRoom: true,
      roomId: room.roomId,
      state: room.state,
      language: room.language,
      hrName: room.hrUser?.name || room.lastHrUser?.name || "HR",
      candidateName: room.lastCandidateUser?.name || room.candidateUser?.name || profile.displayName,
      remainingMs,
      expiresAt: remainingMs !== null ? new Date(Date.now() + remainingMs).toISOString() : null,
    });
  } catch (err) {
    sendApiError(res, err, "Could not check candidate recovery room");
  }
});

app.get("/api/candidate/portfolio", async (req, res) => {
  try {
    const { user, profile } = await getAuthenticatedRequestContext(req);
    if (profile.role !== "candidate") {
      return res.json({
        portfolioReady: false,
        reason: "Portfolio display is available for candidate accounts only.",
        verification: null,
        video: null,
        transcript: null,
      });
    }

    const portfolio = await buildCandidatePortfolio(user.id);
    res.json(portfolio);
  } catch (err) {
    sendApiError(res, err, "Could not load candidate portfolio");
  }
});

app.get("/api/candidate-videos/state", async (req, res) => {
  try {
    const { user, profile } = await getAuthenticatedRequestContext(req);
    const roomId = req.query.roomId;
    const room = getRoom(roomId);
    if (!room) return res.status(404).json({ error: "Room not found" });

    if (profile.role === "candidate") assertRoomParticipant(room, user.id, "candidate");
    if (profile.role === "hr") assertRoomParticipant(room, user.id, "hr");

    const state = await buildCandidateVideoState(room, { userId: user.id, role: profile.role });
    res.json(state);
  } catch (err) {
    sendApiError(res, err, "Could not load video state");
  }
});

app.post("/api/candidate-videos/init-upload", async (req, res) => {
  try {
    const { user, profile } = await getAuthenticatedRequestContext(req);
    const { roomId, fileName, mimeType, fileSize } = req.body || {};
    if (profile.role !== "candidate") return res.status(403).json({ error: "Only candidates can upload verification videos" });
    assertAllowedCandidateVideoFile({ mimeType, fileSize });

    const room = getRoom(roomId);
    assertRoomParticipant(room, user.id, "candidate");

    // Protect against existing approved verification at the database API level
    const { data: verification, error: verError } = await supabaseAdmin
      .from("candidate_verification")
      .select("candidate_user_id")
      .eq("candidate_user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (verError) throw verError;
    if (verification) {
      return res.status(409).json({ error: "Candidate verification is already approved." });
    }

    const state = await buildCandidateVideoState(room, { userId: user.id, role: profile.role });
    if (!state.uploadAllowed) return res.status(409).json({ error: state.reason || "Upload is not allowed right now" });

    const videoId = crypto.randomUUID();
    const storagePath = getVideoStoragePath({
      candidateUserId: user.id,
      source: "candidate_upload",
      videoId,
      mimeType,
      fileName,
    });

    const { data: signedUpload, error: signedError } = await supabaseAdmin.storage
      .from(candidateVideoBucket)
      .createSignedUploadUrl(storagePath);
    if (signedError) throw signedError;

    const { data: video, error: insertError } = await supabaseAdmin
      .from("candidate_videos")
      .insert([{
        id: videoId,
        candidate_user_id: user.id,
        hr_user_id: room.hrUser?.authUserId || null,
        interview_id: room.interviewSessionId,
        room_id: room.roomId,
        source: "candidate_upload",
        status: "uploading",
        storage_bucket: candidateVideoBucket,
        storage_path: storagePath,
        file_name: fileName || null,
        mime_type: mimeType,
        file_size: Number(fileSize),
        uploaded_by_user_id: user.id,
      }])
      .select()
      .single();
    if (insertError) throw insertError;

    res.json({ video: mapVideoForClient(video), upload: signedUpload });
  } catch (err) {
    sendApiError(res, err, "Could not initialize upload");
  }
});

app.post("/api/candidate-videos/hr-recording/init-upload", async (req, res) => {
  try {
    const { user, profile } = await getAuthenticatedRequestContext(req);
    const { roomId, fileName, mimeType, fileSize, durationSeconds } = req.body || {};
    if (profile.role !== "hr") return res.status(403).json({ error: "Only HR can save candidate recordings" });
    assertAllowedCandidateVideoFile({ mimeType, fileSize });

    const room = getRoom(roomId);
    assertRoomParticipant(room, user.id, "hr");
    if (!room.interviewSessionId || !room.candidateUser || !room.hrUser) {
      return res.status(409).json({ error: "Recording can be saved only during an active interview" });
    }

    // Protect against existing approved verification at database API level
    const { data: verification, error: verError } = await supabaseAdmin
      .from("candidate_verification")
      .select("candidate_user_id")
      .eq("candidate_user_id", room.candidateUser.authUserId)
      .eq("is_active", true)
      .maybeSingle();

    if (verError) throw verError;
    if (verification) {
      return res.status(409).json({ error: "Candidate verification is already approved." });
    }

    const videoId = crypto.randomUUID();
    const storagePath = getVideoStoragePath({
      candidateUserId: room.candidateUser.authUserId,
      source: "hr_recording",
      videoId,
      mimeType,
      fileName,
    });

    const { data: signedUpload, error: signedError } = await supabaseAdmin.storage
      .from(candidateVideoBucket)
      .createSignedUploadUrl(storagePath);
    if (signedError) throw signedError;

    const { data: video, error: insertError } = await supabaseAdmin
      .from("candidate_videos")
      .insert([{
        id: videoId,
        candidate_user_id: room.candidateUser.authUserId,
        hr_user_id: user.id,
        interview_id: room.interviewSessionId,
        room_id: room.roomId,
        source: "hr_recording",
        status: "uploading",
        storage_bucket: candidateVideoBucket,
        storage_path: storagePath,
        file_name: fileName || null,
        mime_type: mimeType,
        file_size: Number(fileSize),
        duration_seconds: durationSeconds || null,
        uploaded_by_user_id: user.id,
      }])
      .select()
      .single();
    if (insertError) throw insertError;

    res.json({ video: mapVideoForClient(video), upload: signedUpload });
  } catch (err) {
    sendApiError(res, err, "Could not initialize recording upload");
  }
});


app.post("/api/candidate-videos/:videoId/cancel-upload", async (req, res) => {
  try {
    const { user, profile } = await getAuthenticatedRequestContext(req);
    const { videoId } = req.params;
    const { data: video, error } = await supabaseAdmin
      .from("candidate_videos")
      .select("*")
      .eq("id", videoId)
      .single();
    if (error) throw error;
    const room = getRoomByCandidateId(video.candidate_user_id);
    const isOwningCandidate = profile.role === "candidate" && video.candidate_user_id === user.id;
    const isAssignedHr = profile.role === "hr" && room?.hrUser?.authUserId === user.id;
    if (!isOwningCandidate && !isAssignedHr) {
      return res.status(403).json({ error: "Candidate upload access required" });
    }
    if (video.source !== "candidate_upload" || !["uploading", "enr"].includes(video.status)) {
      return res.status(409).json({ error: "Only in-progress or active candidate uploads can be reset" });
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("candidate_videos")
      .update({ status: "archived", dismissed_at: now, updated_at: now })
      .eq("id", videoId)
      .select()
      .single();
    if (updateError) throw updateError;

    if (room) await emitCandidateVideoState(room.roomId);
    res.json({ video: mapVideoForClient(updated) });
  } catch (err) {
    sendApiError(res, err, "Could not cancel upload");
  }
});

app.post("/api/candidate-videos/:videoId/complete-upload", async (req, res) => {
  try {
    const { user, profile } = await getAuthenticatedRequestContext(req);
    const { videoId } = req.params;
    const { data: video, error } = await supabaseAdmin
      .from("candidate_videos")
      .select("*")
      .eq("id", videoId)
      .single();
    if (error) throw error;
    if (video.status !== "uploading") return res.status(409).json({ error: "Upload has already been completed" });

    const room = getRoomForCandidateVideoAction(video);
    if (video.source === "candidate_upload") {
      if (profile.role !== "candidate" || video.candidate_user_id !== user.id) return res.status(403).json({ error: "Candidate upload access required" });
      assertRoomParticipant(room, user.id, "candidate");
    } else {
      if (profile.role !== "hr" || video.hr_user_id !== user.id) return res.status(403).json({ error: "HR recording access required" });
      assertRoomParticipant(room, user.id, "hr");
    }

    const now = new Date().toISOString();

    // Enforce global constraint: archive any existing 'enr' videos for this candidate
    const { error: archiveError } = await supabaseAdmin
      .from("candidate_videos")
      .update({ status: "archived", updated_at: now })
      .eq("candidate_user_id", video.candidate_user_id)
      .eq("status", "enr");
    if (archiveError) throw archiveError;

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("candidate_videos")
      .update({ status: "enr", updated_at: now })
      .eq("id", videoId)
      .select()
      .single();
    if (updateError) throw updateError;

    if (room) await emitCandidateVideoState(room.roomId);
    res.json({ video: mapVideoForClient(updated) });
  } catch (err) {
    sendApiError(res, err, "Could not complete upload");
  }
});

app.post("/api/candidate-videos/:videoId/approve", async (req, res) => {
  try {
    const { user, profile } = await getAuthenticatedRequestContext(req);
    if (profile.role !== "hr") return res.status(403).json({ error: "Only HR can approve videos" });
    const { videoId } = req.params;
    const { data: video, error } = await supabaseAdmin
      .from("candidate_videos")
      .select("*")
      .eq("id", videoId)
      .single();
    if (error) throw error;
    const room = getRoomForCandidateVideoAction(video);
    assertRoomParticipant(room, user.id, "hr");
    if (video.status !== "enr") return res.status(409).json({ error: "Only pending videos can be approved" });

    const hrDisplayName = await getDisplayNameForUserId(user.id, "HR");

    // Execute transactional approval through PostgreSQL RPC function
    const { error: rpcError } = await supabaseAdmin.rpc("approve_candidate_video", {
      p_video_id: videoId,
      p_hr_user_id: user.id,
      p_hr_name_snapshot: hrDisplayName,
    });
    if (rpcError) throw rpcError;

    const { data: updatedVideo, error: videoFetchError } = await supabaseAdmin
      .from("candidate_videos")
      .select("*")
      .eq("id", videoId)
      .single();
    if (videoFetchError) throw videoFetchError;

    if (room) await emitCandidateVideoState(room.roomId);
    res.json({ video: mapVideoForClient(updatedVideo) });
  } catch (err) {
    sendApiError(res, err, "Could not approve video");
  }
});

app.post("/api/candidate-videos/:videoId/dismiss", async (req, res) => {
  try {
    const { user, profile } = await getAuthenticatedRequestContext(req);
    if (profile.role !== "hr") return res.status(403).json({ error: "Only HR can dismiss videos" });
    const { videoId } = req.params;
    const { data: video, error } = await supabaseAdmin
      .from("candidate_videos")
      .select("*")
      .eq("id", videoId)
      .single();
    if (error) throw error;
    const room = getRoomForCandidateVideoAction(video);
    assertRoomParticipant(room, user.id, "hr");
    if (video.status !== "enr") return res.status(409).json({ error: "Only pending videos can be dismissed" });

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("candidate_videos")
      .update({ status: "archived", dismissed_at: now, updated_at: now })
      .eq("id", videoId)
      .select()
      .single();
    if (updateError) throw updateError;

    if (room) await emitCandidateVideoState(room.roomId);
    res.json({ video: mapVideoForClient(updated) });
  } catch (err) {
    sendApiError(res, err, "Could not dismiss video");
  }
});

app.post("/api/admin/candidate/:candidateId/reset-verification", async (req, res) => {
  try {
    const { user, profile } = await getAuthenticatedRequestContext(req);
    if (profile.role !== "super_admin") return res.status(403).json({ error: "Only administrators can reset verification" });
    const { candidateId } = req.params;

    // Execute transactional reset through PostgreSQL RPC function
    const { error: rpcError } = await supabaseAdmin.rpc("reset_candidate_verification", {
      p_candidate_user_id: candidateId,
    });
    if (rpcError) throw rpcError;

    // Scan for any active rooms containing the candidate and broadcast updates
    for (const room of getAllRooms()) {
      const fullRoom = getRoom(room.roomId);
      if (
        fullRoom?.candidateUser?.authUserId === candidateId ||
        fullRoom?.lastCandidateUser?.authUserId === candidateId
      ) {
        await emitCandidateVideoState(fullRoom.roomId);
      }
    }

    res.json({ status: "ok", message: "Verification state reset successfully" });
  } catch (err) {
    sendApiError(res, err, "Could not reset candidate verification");
  }
});
io.on("connection", (socket) => {
  const existingSocketId = activeUserSockets.get(socket.data.userId);
  if (existingSocketId && existingSocketId !== socket.id) {
    const existingSocket = io.sockets.sockets.get(existingSocketId);
    if (existingSocket) {
      existingSocket.data.replacedBySocketId = socket.id;
      existingSocket.emit("force-logout", "This account was signed in from another device. You have been logged out here.");
      existingSocket.disconnect(true);
    }
  }
  activeUserSockets.set(socket.data.userId, socket.id);

  console.log(`[Socket] Authorized: ${socket.id} as ${socket.data.role}`);

  socket.on("candidate-create-room", async ({ userName, language }) => {
    if (socket.data.role !== "candidate") {
      socket.emit("join-error", "Only candidates can create waiting rooms.");
      return;
    }

    // FIX: Prevent phantom duplicate rooms.
    // If this candidate already has a live or recovering room, redirect them
    // back into it instead of creating a second one.
    const existingRoom = getAllRooms().find(
      (r) =>
        r.candidateName &&
        (getRoom(r.roomId)?.candidateUser?.authUserId === socket.data.userId ||
          getRoom(r.roomId)?.lastCandidateUser?.authUserId === socket.data.userId)
    );
    if (existingRoom) {
      const liveRoom = getRoom(existingRoom.roomId);
      if (liveRoom) {
        const durableName = socket.data.displayName || userName || getEmailPrefix(socket.data.email);
        socket.data.userName = durableName;
        socket.data.roomId = liveRoom.roomId;
        socket.data.role = "candidate";
        socket.data.language = liveRoom.language;
        socket.data.agoraUid = createAgoraUid(socket.data.userId, liveRoom.roomId, "candidate");

        joinRoom(liveRoom.roomId, socket.id, durableName, socket.data.userId, "candidate", socket.data.agoraUid);
        socket.join(liveRoom.roomId);

        socket.emit("join-ack", { roomId: liveRoom.roomId, role: "candidate", language: liveRoom.language });

        if (
          candidateRecoveryTimers.has(liveRoom.roomId) ||
          liveRoom.state === "candidate_recovering" ||
          liveRoom.state === "candidate_timeout" ||
          liveRoom.state === "waiting_for_candidate"
        ) {
          cancelCandidateRecovery(liveRoom.roomId);
          io.to(liveRoom.roomId).emit("candidate-rejoined", {
            message: "The candidate has reconnected.",
            candidateName: durableName,
          });
        }
        if (abandonedRecoveryTimers.has(liveRoom.roomId)) {
          cancelAbandonedMode(liveRoom.roomId);
          io.to(liveRoom.roomId).emit("room-recovered", { message: `${durableName} has joined the room.` });
        }

        broadcastProjectedRoomState(liveRoom.roomId);
        console.log(`[Recovery] Candidate rejoined existing room ${liveRoom.roomId} instead of creating a new one.`);
        return;
      }
    }

    const roomId = createInternalRoomId();
    const roomLanguage = normalizeLanguage(language);
    const durableName = socket.data.displayName || userName || getEmailPrefix(socket.data.email);

    socket.data.userName = durableName;
    socket.data.roomId = roomId;
    socket.data.role = "candidate";
    socket.data.language = roomLanguage;
    socket.data.agoraUid = createAgoraUid(socket.data.userId, roomId, "candidate");

    createRoom(roomId, roomLanguage);
    joinRoom(roomId, socket.id, durableName, socket.data.userId, "candidate", socket.data.agoraUid);
    socket.join(roomId);

    socket.emit("join-ack", { roomId, role: "candidate", language: roomLanguage });
    broadcastProjectedRoomState(roomId);
  });

  socket.on("join-room", async ({ roomId, userName, role }) => {
    const requestedRole = socket.data.role || "candidate";
    if (role && role !== requestedRole) {
      socket.emit("join-error", `Your account is authorized as ${requestedRole}, not ${role}.`);
      return;
    }
    const room = getRoom(roomId);
    if (!room) {
      socket.emit("join-error", "Room is no longer available.");
      return;
    }

    const isRecoveringRoom = room.state === "hr_recovering";

    // Candidate guard: must be the original candidate
    if (
      requestedRole === "candidate" &&
      room.candidateUser?.authUserId !== socket.data.userId &&
      room.lastCandidateUser?.authUserId !== socket.data.userId
    ) {
      socket.emit("join-error", "Candidates must choose a language and use Join a Room.");
      return;
    }

    // HR guard: language must match
    if (requestedRole === "hr" && room.language !== socket.data.language) {
      socket.emit("join-error", "This candidate is waiting for a different language.");
      return;
    }

    // Super Admin guard: allow observing recovering rooms (HR is absent but candidate is present)
    if (requestedRole === "super_admin" && !isRecoveringRoom && (!room.candidateUser || !room.hrUser)) {
      socket.emit("join-error", "Super Admins can only observe full ongoing calls.");
      return;
    }

    // Full-room guards
    if (
      requestedRole === "candidate" &&
      room.candidateUser &&
      room.candidateUser.authUserId !== socket.data.userId
    ) {
      socket.emit("join-error", "This room is already full: A Candidate has already joined this session.");
      return;
    }
    // HR full-room guard: skip if room is recovering (any HR can rescue)
    if (
      requestedRole === "hr" &&
      !isRecoveringRoom &&
      room.hrUser &&
      room.hrUser.authUserId !== socket.data.userId
    ) {
      socket.emit("join-error", "This room is already full: An HR Interviewer has already joined this session.");
      return;
    }
    if (requestedRole === "super_admin" && room.hiddenObservers.size > 0) {
      const existingObserver = Array.from(room.hiddenObservers.values()).find(
        (observer) => observer.authUserId === socket.data.userId
      );
      if (!existingObserver) {
        socket.emit("join-error", "This room is already full: A Super Admin Observer has already joined this session.");
        return;
      }
    }

    // Evict stale socket for this role if it exists
    const existingSocketIdForRole =
      requestedRole === "candidate"
        ? room.candidateUser?.id
        : requestedRole === "hr"
        ? room.hrUser?.id
        : Array.from(room.hiddenObservers.values()).find((observer) => observer.authUserId === socket.data.userId)?.id;

    if (existingSocketIdForRole && existingSocketIdForRole !== socket.id) {
      const existingRoomSocket = io.sockets.sockets.get(existingSocketIdForRole);
      if (existingRoomSocket) {
        existingRoomSocket.data.isBeingReplaced = true;
        existingRoomSocket.data.replacedBySocketId = socket.id;
        existingRoomSocket.leave(roomId);
        existingRoomSocket.data.roomId = null;
        existingRoomSocket.emit("force-logout", "This account was signed in from another device. You have been logged out here.");
        existingRoomSocket.disconnect(true);
      }
    }

    const durableName = socket.data.displayName || userName || getEmailPrefix(socket.data.email);
    socket.data.userName = durableName;
    socket.data.roomId = roomId;
    socket.data.role = requestedRole;
    socket.data.language = room.language;
    socket.data.agoraUid = createAgoraUid(socket.data.userId, roomId, requestedRole);

    joinRoom(roomId, socket.id, durableName, socket.data.userId, requestedRole, socket.data.agoraUid);
    socket.join(roomId);

    // ── RECOVERY CANCELLATION ──
    if (abandonedRecoveryTimers.has(roomId)) {
      cancelAbandonedMode(roomId);
      io.to(roomId).emit("room-recovered", { message: `${durableName} has joined the room.` });
      console.log(`[Recovery] ${durableName} rescued abandoned room ${roomId}.`);
      
      const freshRoom = getRoom(roomId);
      if (requestedRole === "candidate" && !freshRoom.hrUser) {
        enterHrRecoveryMode(roomId, null);
      } else if (requestedRole === "hr" && !freshRoom.candidateUser) {
        enterCandidateRecoveryMode(roomId, null);
      }
    }

    if (requestedRole === "hr" && isRecoveringRoom) {
      const prevHrName = room.hrRecovery?.disconnectedHrName || "the previous interviewer";
      cancelHrRecovery(roomId);
      io.to(roomId).emit("hr-rejoined", {
        message: `An interviewer has joined. The session continues.`,
        hrName: durableName,
        prevHrName,
      });
      console.log(`[Recovery] ${durableName} rescued room ${roomId} (prev HR: ${prevHrName}).`);
    } else if (requestedRole === "hr" && hrRecoveryTimers.has(roomId)) {
      cancelHrRecovery(roomId);
      io.to(roomId).emit("hr-rejoined", {
        message: "Your interviewer has reconnected. The session continues.",
        hrName: durableName,
      });
    }

    if (
      requestedRole === "candidate" &&
      (candidateRecoveryTimers.has(roomId) ||
        room.state === "candidate_recovering" ||
        room.state === "candidate_timeout" ||
        room.state === "waiting_for_candidate")
    ) {
      cancelCandidateRecovery(roomId);
      io.to(roomId).emit("candidate-rejoined", {
        message: "The candidate has reconnected.",
        candidateName: durableName,
      });
      console.log(`[Recovery] ${durableName} candidate rescued room ${roomId}.`);
    }


    if (requestedRole === "hr") {
      try {
        await createOrReuseActiveInterview(roomId, socket);
      } catch (err) {
        console.error("[DB Error] Failed to create/reuse interview on HR join:", err);
        socket.emit("join-error", "Could not create the interview session.");
        return;
      }
    }

    await hydrateRoomWithLatestCandidateTranscript(roomId);

    socket.emit("join-ack", { roomId, role: requestedRole });
    broadcastProjectedRoomState(roomId);
    await emitCandidateVideoState(roomId);
  });

  socket.on("start-transcription", async ({ roomId }) => {
    if (!isSocketInRoom(socket, roomId)) return;
    if (socket.data.role !== "hr") {
      console.warn(`[Security] User ${socket.data.email} attempted to start transcription without HR role.`);
      return;
    }
    
    const room = getRoom(roomId);
    if (!room || room.state === "transcribing" || room.activeTranscriptionSession.isActive || transcriptionCountdowns.has(roomId)) return;
    if (!room.candidateUser) {
      socket.emit("transcript-save-error", "Candidate must be in the room before transcription can start.");
      return;
    }
    if (!room.interviewSessionId) {
      try {
        await createOrReuseActiveInterview(roomId, socket);
      } catch (err) {
        console.error("[DB Error] Failed to create interview before transcription:", err);
        socket.emit("transcript-save-error", "Interview session is not ready yet.");
        return;
      }
    }

    room.state = "active";
    room.activeTranscriptionSession.isActive = false;
    room.activeTranscriptionSession.startedBy = socket.data.userId;
    room.activeTranscriptionSession.targetSpeakerId = room.candidateUser?.id;

    io.to(roomId).emit("transcription-starting", { countdown: 10 });
    
    let countdown = 10;
    const interval = setInterval(() => {
      const activeRoom = getRoom(roomId);
      if (!activeRoom || activeRoom.state !== "active") {
        clearCountdown(roomId);
        return;
      }

      countdown--;
      io.to(roomId).emit("countdown-tick", { countdown });
      
      if (countdown <= 0) {
        clearCountdown(roomId);
        activeRoom.state = "transcribing";
        activeRoom.activeTranscriptionSession.isActive = true;
        activeRoom.activeTranscriptionSession.startedAt = Date.now();
        broadcastProjectedRoomState(roomId);

        // Open Deepgram Session at room scope
        let dgState = activeDeepgramConnections.get(roomId);
        if (!dgState) {
          dgState = {
            dgConnection: null,
            isDeepgramConnecting: false,
            isDgOpen: false,
            audioQueue: []
          };
          activeDeepgramConnections.set(roomId, dgState);
        }

        if (!dgState.dgConnection && !dgState.isDeepgramConnecting) {
          dgState.isDeepgramConnecting = true;
          dgState.audioQueue = [];
          try {
            console.log(`[Deepgram] Starting live transcription for room ${roomId} using model ${deepgramModel}`);
            const dgConnection = deepgram.listen.live({
              model: deepgramModel,
              language: deepgramLanguage,
              smart_format: true,
              punctuate: true,
              encoding: "linear16",
              sample_rate: 16000,
              channels: 1,
              interim_results: true,
              endpointing: 300,
              vad_events: true,
            });
            dgState.dgConnection = dgConnection;
            setupDeepgramEvents(dgConnection, roomId, activeRoom.candidateUser?.name || "Candidate", activeRoom.candidateUser?.id, "candidate");
          } catch (err) {
            console.error("[Deepgram] Start failed:", err);
            dgState.isDeepgramConnecting = false;
            dgState.isDgOpen = false;
          }
        }
      }
    }, 1000);
    transcriptionCountdowns.set(roomId, interval);
  });

  socket.on("hr-keep-waiting", ({ roomId }) => {
    if (!isSocketInRoom(socket, roomId)) return;
    if (socket.data.role !== "hr" && socket.data.role !== "super_admin") return;
    const room = getRoom(roomId);
    if (!room) return;
    room.state = "waiting_for_candidate";
    broadcastProjectedRoomState(roomId);
  });

  socket.on("hr-end-interview", async ({ roomId }) => {
    if (!isSocketInRoom(socket, roomId)) return;
    if (socket.data.role !== "hr" && socket.data.role !== "super_admin") return;
    const room = getRoom(roomId);
    if (!room) return;
    
    socket.data.intentionalLeave = true;
    if (room.activeTranscriptionSession?.isActive || transcriptionCountdowns.has(roomId)) {
      stopTranscriptionForRoom(roomId, { emitStopped: false });
    }
    await executeFinalTeardown(roomId, socket, { reason: "hr-ended", intentional: true });
  });

  socket.on("end-interview", async ({ roomId }) => {
    if (!isSocketInRoom(socket, roomId)) return;
    if (socket.data.role !== "hr" && socket.data.role !== "super_admin") return;

    const room = getRoom(roomId);
    if (!room) return;

    // Mark intentional so handleLeave (triggered by disconnect after this) skips recovery
    socket.data.intentionalLeave = true;

    // Stop any live transcription cleanly before teardown
    if (room.activeTranscriptionSession?.isActive || transcriptionCountdowns.has(roomId)) {
      stopTranscriptionForRoom(roomId, { emitStopped: false });
    }

    // Single authoritative teardown — sets status "completed", reason "hr_ended"
    await executeFinalTeardown(roomId, socket, { reason: "hr-ended", intentional: true });
  });

  socket.on("stop-transcription", async ({ roomId }) => {
    if (!isSocketInRoom(socket, roomId)) return;
    if (socket.data.role !== "hr") {
      console.warn(`[Security] User ${socket.data.email} attempted to stop transcription without HR role.`);
      return;
    }

    const stopped = stopTranscriptionForRoom(roomId);
    if (!stopped) return;

    const room = getRoom(roomId);
    if (room?.interviewSessionId) {
      try {
        const { error } = await supabaseAdmin
          .from("interviews")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", room.interviewSessionId);
        if (error) console.error("[DB Error] Failed to pause interview:", error);
      } catch (err) {
        console.error("[DB Catch] Error pausing interview:", err);
      }
    }
  });

  socket.on("save-final-transcript", async ({ roomId }) => {
    if (!isSocketInRoom(socket, roomId)) return;
    if (socket.data.role !== "hr") {
      socket.emit("transcript-save-error", "Only HR can save the final transcript.");
      return;
    }

    const room = getRoom(roomId);
    if (!room) {
      socket.emit("transcript-save-error", "Room not found.");
      return;
    }

    try {
      const result = await persistRoomTranscript(room, { savedByUserId: socket.data.userId, reason: "manual-save" });
      socket.emit("transcript-saved", result);
      broadcastProjectedRoomState(roomId);
    } catch (err) {
      console.error("[DB Error] Manual transcript save failed:", err);
      socket.emit("transcript-save-error", "Could not save transcript.");
    }
  });

  socket.on("hr-recording-state", ({ roomId, isRecording }) => {
    if (!isSocketInRoom(socket, roomId)) return;
    if (socket.data.role !== "hr") return;
    const room = getRoom(roomId);
    if (!room) return;

    io.to(roomId).emit("hr-recording-state", {
      roomId,
      isRecording: Boolean(isRecording),
      hrName: room.hrUser?.name || socket.data.displayName || "HR",
    });
  });

  // STRICT PCM ROUTING AUTHORITY
  socket.on("audio-chunk", ({ roomId, audio }) => {
    const activeRoomId = roomId || socket.data.roomId;
    if (!isSocketInRoom(socket, activeRoomId)) return;
    if (!activeRoomId) return;
    
    const room = getRoom(activeRoomId);
    
    // Only process if it's the candidate and transcription is active
    if (!room || !room.activeTranscriptionSession.isActive || socket.data.role !== "candidate") {
      // Discard PCM payload
      return; 
    }

    const dgState = activeDeepgramConnections.get(activeRoomId);
    if (dgState) {
      const isReady = dgState.isDgOpen || (dgState.dgConnection && dgState.dgConnection.socket && dgState.dgConnection.socket.readyState === 1);
      if (dgState.dgConnection && isReady) {
        try { dgState.dgConnection.send(audio); } catch(e) {}
      } else if (dgState.isDeepgramConnecting) {
        dgState.audioQueue.push(audio);
        if (dgState.audioQueue.length > 100) dgState.audioQueue.shift();
      }
    }
  });

  function setupDeepgramEvents(dg, roomId, userName, speakerId, forcedRole = "candidate") {
    dg.on(LiveTranscriptionEvents.Open, () => {
      console.log(`[Deepgram] Connection opened for room: ${roomId}`);
      const dgState = activeDeepgramConnections.get(roomId);
      if (dgState) {
        dgState.isDeepgramConnecting = false;
        dgState.isDgOpen = true;
        while (dgState.audioQueue.length > 0) {
          try { dg.send(dgState.audioQueue.shift()); } catch(e) {}
        }
      }
    });

    dg.on(LiveTranscriptionEvents.Transcript, (data) => {
      const transcript = data.channel.alternatives[0].transcript;
      if (transcript && transcript.trim() && roomId) {
        const isFinal = data.is_final === true || data.speech_final === true;
        const room = getRoom(roomId);
        if (!room) return;

        // Turn Engine logic
        if (!room.activeSpeakers.has(userName)) {
          const crypto = require('crypto');
          const blockId = crypto.randomUUID(); // uuid v4
          
          const newBlock = {
            id: blockId,
            speakerId: speakerId,
            speakerName: userName,
            speakerRole: forcedRole,
            content: "",
            segments: [],
            status: "live",
            isLive: true,
            isFinal: false,
            version: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            editableBy: [userName, room.hrUser?.name].filter(Boolean),
            roomId: roomId
          };
          addBlock(roomId, newBlock);
          room.activeSpeakers.set(userName, { blockId: blockId, committedSegments: [], liveSegment: null });
        }

        const buffer = room.activeSpeakers.get(userName);
        const block = room.blocks.find(b => b.id === buffer.blockId);

        if (block) {
          if (!isFinal) {
            buffer.liveSegment = { text: transcript.trim(), isFinal, timestamp: Date.now() };
            block.segments = [...buffer.committedSegments, buffer.liveSegment];
          } else {
            buffer.committedSegments.push({ text: transcript.trim(), isFinal, timestamp: Date.now() });
            buffer.liveSegment = null;
            block.segments = buffer.committedSegments;
          }

          block.content = block.segments.map(s => s.text).join(" ");
          block.updatedAt = Date.now();
          block.version += 1;

          io.to(roomId).emit("block-update", block);

          // Silence segmentation
          if (isFinal) {
            const timeoutKey = `${roomId}-${userName}`;
            if (speakerTimeouts.has(timeoutKey)) clearTimeout(speakerTimeouts.get(timeoutKey));
            
            speakerTimeouts.set(timeoutKey, setTimeout(() => {
              const finalBlock = room.blocks.find(b => b.id === buffer.blockId);
              if (finalBlock) {
                finalBlock.status = "final";
                finalBlock.isLive = false;
                finalBlock.isFinal = true;
                finalBlock.version += 1;
                finalBlock.updatedAt = Date.now();
                io.to(roomId).emit("block-update", finalBlock);
              }
              room.activeSpeakers.delete(userName);
              speakerTimeouts.delete(timeoutKey);
            }, 3000));
          }
        }
      }
    });

    dg.on(LiveTranscriptionEvents.Close, (event) => {
      const closeCode = event?.code ?? event?.target?.readyState ?? "unknown";
      const closeReason = event?.reason || event?.message || "No close reason provided";
      console.log(`[Deepgram] Connection closed for room ${roomId}. code=${closeCode}; reason=${closeReason}`);
      const dgState = activeDeepgramConnections.get(roomId);
      if (dgState?.dgConnection === dg) {
        activeDeepgramConnections.delete(roomId);
        markTranscriptionUnavailable(roomId);
      }
    });

    dg.on(LiveTranscriptionEvents.Error, (err) => {
      const details = {
        message: err?.message || err?.error?.message || err?.type || "Unknown Deepgram websocket error",
        code: err?.code || err?.error?.code || err?.target?.readyState,
        status: err?.status || err?.error?.status,
      };
      console.error(`[Deepgram] Connection error for room ${roomId}:`, details);
      const dgState = activeDeepgramConnections.get(roomId);
      if (dgState?.dgConnection === dg) {
        activeDeepgramConnections.delete(roomId);
        markTranscriptionUnavailable(roomId);
      }
    });
  }

  socket.on("toggle-mute", ({ roomId, isMuted }) => {
    if (!isSocketInRoom(socket, roomId)) return;
    toggleMute(roomId, socket.id, isMuted);
    broadcastProjectedRoomState(roomId);
  });

  socket.on("toggle-video", ({ roomId, isVideoEnabled }) => {
    if (!isSocketInRoom(socket, roomId)) return;
    toggleVideo(roomId, socket.id, isVideoEnabled);
    broadcastProjectedRoomState(roomId);
  });


  socket.on("transcript-edit", ({ roomId, blockId, content }) => {
    if (!isSocketInRoom(socket, roomId) || !canManageTranscript(socket)) return;
    updateBlockContent(roomId, blockId, content);
    broadcastProjectedRoomState(roomId);
  });

  socket.on("clear-transcript", ({ roomId }) => {
    if (!isSocketInRoom(socket, roomId) || !canManageTranscript(socket)) return;
    const room = getRoom(roomId);
    if (room) {
      room.blocks = [];
      room.activeSpeakers.clear();
      clearSpeakerTimeouts(roomId);
      broadcastProjectedRoomState(roomId);
    }
  });

  socket.on("transcript-replace", ({ roomId, content }) => {
    if (!isSocketInRoom(socket, roomId) || !canManageTranscript(socket)) return;
    const room = getRoom(roomId);
    if (room) {
      const crypto = require('crypto');
      const blockId = crypto.randomUUID();
      const newBlock = {
        id: blockId,
        speakerId: room.candidateUser?.id || "",
        speakerName: room.candidateUser?.name || "Candidate",
        speakerRole: "candidate",
        content: content,
        segments: [{ text: content, isFinal: true, timestamp: Date.now() }],
        status: "final",
        isLive: false,
        isFinal: true,
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        editableBy: [room.candidateUser?.name, room.hrUser?.name].filter(Boolean),
        roomId: roomId
      };
      room.blocks = [newBlock];
      room.activeSpeakers.clear();
      clearSpeakerTimeouts(roomId);
      broadcastProjectedRoomState(roomId);
    }
  });

  socket.on("leave-room", () => {
    // Explicit leave is intentional — skip recovery mode for HR
    if (socket.data.role === "hr") {
      socket.data.intentionalLeave = true;
    }
    handleLeave(socket);
  });
  socket.on("disconnect", () => {
    // intentionalLeave is only true if set by end-interview or leave-room
    // An unexpected disconnect will NOT have it set, triggering recovery
    handleLeave(socket);
  });
});

function handleLeave(socket) {
  if (socket.data.userId && activeUserSockets.get(socket.data.userId) === socket.id) {
    activeUserSockets.delete(socket.data.userId);
  }

  const roomId = socket.data.roomId;
  const role = socket.data.role;
  if (!roomId) return;

  const room = getRoom(roomId);

  // Stale socket being replaced by a new connection — evict silently
  if (socket.data.isBeingReplaced) {
    socket.leave(roomId);
    return;
  }

  if (!room) {
    socket.leave(roomId);
    return;
  }

  // ── HR LEAVE ─────────────────────────────────────────────────────────────
  if (role === "hr") {
    const isActiveHrSocket = room.hrUser?.id === socket.id;

    if (!isActiveHrSocket) {
      leaveRoom(roomId, socket.id);
      socket.leave(roomId);
      broadcastProjectedRoomState(roomId);
      return;
    }

    if (hrRecoveryTimers.has(roomId) || abandonedRecoveryTimers.has(roomId)) {
      socket.leave(roomId);
      return;
    }

    if (socket.data.intentionalLeave) {
      void executeFinalTeardown(roomId, socket, { reason: "hr-ended", intentional: true });
    } else {
      // It's an unexpected HR disconnect. If candidate is absent, room is abandoned.
      if (!room.candidateUser) {
        leaveRoom(roomId, socket.id);
        socket.leave(roomId);
        enterAbandonedMode(roomId);
      } else {
        enterHrRecoveryMode(roomId, socket);
      }
    }
    return;
  }

  // ── CANDIDATE LEAVE ────────────────────────────────────────
  if (role === "candidate") {
    const isActiveCandidateSocket = room.candidateUser?.id === socket.id;

    if (!isActiveCandidateSocket) {
      leaveRoom(roomId, socket.id);
      socket.leave(roomId);
      broadcastProjectedRoomState(roomId);
      return;
    }

    if (candidateRecoveryTimers.has(roomId) || abandonedRecoveryTimers.has(roomId)) {
      socket.leave(roomId);
      return;
    }

    if (socket.data.intentionalLeave) {
      if (room.activeTranscriptionSession?.isActive || transcriptionCountdowns.has(roomId)) {
        stopTranscriptionForRoom(roomId, { emitStopped: true });
      }
      finalizeAllActiveSpeakers(roomId);
      leaveRoom(roomId, socket.id);
      socket.leave(roomId);
      broadcastProjectedRoomState(roomId);
    } else {
      // It's an unexpected Candidate disconnect. If HR is absent, room is abandoned.
      if (!room.hrUser) {
        leaveRoom(roomId, socket.id);
        socket.leave(roomId);
        enterAbandonedMode(roomId);
      } else {
        enterCandidateRecoveryMode(roomId, socket);
      }
    }
    return;
  }

  // ── SUPER ADMIN LEAVE ────────────────────────────────────────
  if (role === "super_admin") {
    leaveRoom(roomId, socket.id);
    socket.leave(roomId);
  }

  // Only auto-delete if room is truly empty AND not in recovery
  const fresh = getRoom(roomId);
  if (fresh && !fresh.candidateUser && !fresh.hrUser && fresh.hiddenObservers.size === 0) {
    if (!hrRecoveryTimers.has(roomId) && !candidateRecoveryTimers.has(roomId) && !abandonedRecoveryTimers.has(roomId)) {
      clearCountdown(roomId);
      closeDeepgramForRoom(roomId);
      clearSpeakerTimeouts(roomId);
      deleteRoom(roomId);
      return;
    }
  }
  
  if (fresh) {
    broadcastProjectedRoomState(roomId);
  }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Railway] Server active on port ${PORT}`);
});
