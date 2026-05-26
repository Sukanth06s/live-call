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
const allowedRoles = new Set(["candidate", "hr", "super_admin"]);
const activeUserSockets = new Map(); // Supabase auth user id -> active socket id

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

async function persistRoomTranscript(room, { savedByUserId, reason = "manual" } = {}) {
  const candidateUser = room?.candidateUser || room?.lastCandidateUser;
  if (!candidateUser?.authUserId) {
    throw new Error("Cannot persist transcript without a candidate user");
  }

  finalizeAllActiveSpeakers(room.roomId);

  const candidateUserId = candidateUser.authUserId;
  const hrUserId = room.hrUser?.authUserId || room.lastHrUser?.authUserId || savedByUserId || null;
  const finalTranscript = buildFinalTranscript(room);
  const now = new Date().toISOString();

  if (!room.interviewSessionId) {
    const { data, error } = await supabaseAdmin
      .from("interviews")
      .insert([{
        room_id: room.roomId,
        hr_user_id: hrUserId,
        candidate_user_id: candidateUserId,
        status: "completed",
        started_at: now,
        ended_at: now,
        final_transcript: finalTranscript
      }])
      .select()
      .single();

    if (error) throw error;
    room.interviewSessionId = data.id;
  } else {
    const { error } = await supabaseAdmin
      .from("interviews")
      .update({
        room_id: room.roomId,
        hr_user_id: hrUserId,
        candidate_user_id: candidateUserId,
        status: "completed",
        ended_at: now,
        final_transcript: finalTranscript
      })
      .eq("id", room.interviewSessionId);

    if (error) throw error;
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

  console.log(`[DB] Persisted transcript ${room.interviewSessionId} for candidate ${candidateUserId} (${reason})`);
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

io.on("connection", (socket) => {
  const existingSocketId = activeUserSockets.get(socket.data.userId);
  if (existingSocketId && existingSocketId !== socket.id) {
    const existingSocket = io.sockets.sockets.get(existingSocketId);
    if (existingSocket) {
      if (existingSocket.data.roomId) {
        existingSocket.data.pendingReplacementSocketId = socket.id;
      } else {
        existingSocket.data.isBeingReplaced = true;
        existingSocket.data.replacedBySocketId = socket.id;
        existingSocket.emit("force-logout", "This account was signed in from another device. You have been logged out here.");
        existingSocket.disconnect(true);
      }
    }
  }
  activeUserSockets.set(socket.data.userId, socket.id);

  console.log(`[Socket] Authorized: ${socket.id} as ${socket.data.role}`);

  socket.on("candidate-create-room", async ({ userName, language }) => {
    if (socket.data.role !== "candidate") {
      socket.emit("join-error", "Only candidates can create waiting rooms.");
      return;
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
    if (
      requestedRole === "candidate" &&
      room.candidateUser?.authUserId !== socket.data.userId &&
      room.lastCandidateUser?.authUserId !== socket.data.userId
    ) {
      socket.emit("join-error", "Candidates must choose a language and use Join a Room.");
      return;
    }
    if (requestedRole === "hr" && room.language !== socket.data.language) {
      socket.emit("join-error", "This candidate is waiting for a different language.");
      return;
    }
    if (requestedRole === "super_admin" && (!room.candidateUser || !room.hrUser)) {
      socket.emit("join-error", "Super Admins can only observe full ongoing calls.");
      return;
    }
    if (room) {
      if (
        requestedRole === "candidate" &&
        room.candidateUser &&
        room.candidateUser.authUserId !== socket.data.userId
      ) {
        socket.emit("join-error", "This room is already full: A Candidate has already joined this session.");
        return;
      }
      if (
        requestedRole === "hr" &&
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
    }

    if (room) {
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
    }

    const durableName = socket.data.displayName || userName || getEmailPrefix(socket.data.email);

    socket.data.userName = durableName;
    socket.data.roomId = roomId;
    socket.data.role = requestedRole;
    socket.data.language = room.language;
    socket.data.agoraUid = createAgoraUid(socket.data.userId, roomId, requestedRole);
    
    joinRoom(roomId, socket.id, durableName, socket.data.userId, requestedRole, socket.data.agoraUid);
    socket.join(roomId);

    await hydrateRoomWithLatestCandidateTranscript(roomId);

    socket.emit("join-ack", { roomId, role: requestedRole });
    broadcastProjectedRoomState(roomId);
  });

  socket.on("start-transcription", async ({ roomId }) => {
    if (!isSocketInRoom(socket, roomId)) return;
    if (socket.data.role !== "hr") {
      console.warn(`[Security] User ${socket.data.email} attempted to start transcription without HR role.`);
      return;
    }
    
    const room = getRoom(roomId);
    if (!room || room.state === "active" || room.state === "transcribing" || room.activeTranscriptionSession.isActive || transcriptionCountdowns.has(roomId)) return;
    if (!room.candidateUser) {
      socket.emit("transcript-save-error", "Candidate must be in the room before transcription can start.");
      return;
    }

    room.state = "active";
    room.activeTranscriptionSession.isActive = false;
    room.activeTranscriptionSession.startedBy = socket.data.userId;
    room.activeTranscriptionSession.targetSpeakerId = room.candidateUser?.id;

    // Soft Recovery: Immediately create or reactivate the interview row.
    try {
      if (!room.interviewSessionId) {
        const { data, error } = await supabaseAdmin
          .from('interviews')
          .insert([{
            room_id: roomId,
            hr_user_id: socket.data.userId,
            candidate_user_id: room.candidateUser.authUserId,
            status: 'active',
            started_at: new Date().toISOString()
          }])
          .select()
          .single();

        if (!error && data) {
          room.interviewSessionId = data.id;
          console.log(`[DB] Created interview session: ${data.id}`);
        } else {
          console.error("[DB Error] Failed to create interview:", error);
        }
      } else {
        const { error } = await supabaseAdmin
          .from('interviews')
          .update({
            status: 'active',
            hr_user_id: socket.data.userId,
            candidate_user_id: room.candidateUser.authUserId,
            ended_at: null,
          })
          .eq("id", room.interviewSessionId);
        if (error) console.error("[DB Error] Failed to reactivate interview:", error);
      }
    } catch (e) {
      console.error("[DB Catch] Error creating/reactivating interview:", e);
    }

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
            console.log(`[Deepgram] Starting live transcription for room ${roomId}`);
            const dgConnection = deepgram.listen.live({ model: "nova-2", smart_format: true, encoding: "linear16", sample_rate: 16000 });
            dgState.dgConnection = dgConnection;
            setupDeepgramEvents(dgConnection, roomId, activeRoom.candidateUser?.name || "Candidate", activeRoom.candidateUser?.id);
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

  socket.on("end-interview", async ({ roomId }) => {
    if (!isSocketInRoom(socket, roomId)) return;
    if (socket.data.role !== "hr" && socket.data.role !== "super_admin") return;
    
    const room = getRoom(roomId);
    if (!room) return;

    clearCountdown(roomId);
    room.state = "ended";
    room.activeTranscriptionSession.isActive = false;
    finalizeAllActiveSpeakers(roomId);
    clearSpeakerTimeouts(roomId);

    closeDeepgramForRoom(roomId);

    io.to(roomId).emit("room-closed", "The interview has ended. The session is closed.");

    if ((room.blocks || []).some((block) => (block.content || "").trim()) && (room.candidateUser || room.lastCandidateUser)) {
      try {
        await persistRoomTranscript(room, { savedByUserId: socket.data.userId, reason: "interview-ended" });
      } catch (err) {
        console.error("[DB Error] End interview persistence failed:", err);
      }
    }

    const { regular, superAdmin } = getRoomSocketsByRole(roomId);
    [...regular, ...superAdmin].forEach(sid => {
      const s = io.sockets.sockets.get(sid);
      if (s) {
        s.leave(roomId);
        s.data.roomId = null;
      }
    });
    deleteRoom(roomId);
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
          .update({ status: "paused", updated_at: new Date().toISOString() })
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

  function setupDeepgramEvents(dg, roomId, userName, speakerId) {
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
          
          let speakerRole = "candidate";
          if (room.hrUser && room.hrUser.name === userName) {
            speakerRole = "hr";
          } else if (room.candidateUser && room.candidateUser.name === userName) {
            speakerRole = "candidate";
          }

          const newBlock = {
            id: blockId,
            speakerId: speakerId,
            speakerName: userName,
            speakerRole: speakerRole,
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

    dg.on(LiveTranscriptionEvents.Close, () => {
      console.log(`[Deepgram] Connection closed for room: ${roomId}`);
      const dgState = activeDeepgramConnections.get(roomId);
      if (dgState?.dgConnection === dg) {
        activeDeepgramConnections.delete(roomId);
      }
    });

    dg.on(LiveTranscriptionEvents.Error, (err) => {
      console.error(`[Deepgram] Connection error for room ${roomId}:`, err);
      const dgState = activeDeepgramConnections.get(roomId);
      if (dgState?.dgConnection === dg) {
        activeDeepgramConnections.delete(roomId);
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

  socket.on("leave-room", () => handleLeave(socket));
  socket.on("disconnect", () => {
    handleLeave(socket);
  });
});

function handleLeave(socket) {
  if (socket.data.userId && activeUserSockets.get(socket.data.userId) === socket.id) {
    activeUserSockets.delete(socket.data.userId);
  }

  const roomId = socket.data.roomId;
  const role = socket.data.role;
  if (roomId) {
    const room = getRoom(roomId);
    const isCurrentHrSocket = room?.hrUser?.id === socket.id;

    if (socket.data.isBeingReplaced) {
      socket.leave(roomId);
      return;
    }

    if (room && role === "hr" && !isCurrentHrSocket) {
      leaveRoom(roomId, socket.id);
      socket.leave(roomId);
      broadcastProjectedRoomState(roomId);
      return;
    }

    if (room && role === "hr" && isCurrentHrSocket) {
      console.log(`[Socket] Interviewer (HR) left/disconnected room ${roomId}. Closing room.`);
      clearCountdown(roomId);
      
      // Notify remaining participants in the room
      io.to(roomId).emit("room-closed", "The Interviewer (HR) has disconnected. The session is closed.");
      
      if ((room.blocks || []).some((block) => (block.content || "").trim()) && (room.candidateUser || room.lastCandidateUser)) {
        persistRoomTranscript(room, { savedByUserId: socket.data.userId, reason: "hr-disconnect" })
          .then(() => console.log(`[DB] Successfully closed session on HR disconnect: ${room.interviewSessionId}`))
          .catch(err => console.error("[DB Error] HR disconnect persistence failed:", err));
      } else {
        console.log(`[DB] Skipped HR disconnect persistence for room ${roomId}: no candidate transcript to save.`);
      }
      
      // Clean up Deepgram connection
      closeDeepgramForRoom(roomId);
      clearSpeakerTimeouts(roomId);
      
      // Evict all sockets in that room
      const { regular, superAdmin } = getRoomSocketsByRole(roomId);
      const allSockets = [...regular, ...superAdmin];
      allSockets.forEach(sid => {
        const s = io.sockets.sockets.get(sid);
        if (s) {
          s.leave(roomId);
          s.data.roomId = null;
        }
      });
      
      deleteRoom(roomId);
      return;
    }

    if (room && role === "candidate" && (room.activeTranscriptionSession.isActive || transcriptionCountdowns.has(roomId))) {
      stopTranscriptionForRoom(roomId);
    }

    finalizeAllActiveSpeakers(roomId);
    const updatedRoom = leaveRoom(roomId, socket.id);
    if (!updatedRoom) {
      clearCountdown(roomId);
      closeDeepgramForRoom(roomId);
      clearSpeakerTimeouts(roomId);
    } else {
      broadcastProjectedRoomState(roomId);
    }
    socket.leave(roomId);
  }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Railway] Server active on port ${PORT}`);
});
