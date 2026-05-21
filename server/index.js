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
const jwt = require("jsonwebtoken");
const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
const { createClient: createDeepgramClient, LiveTranscriptionEvents } = require("@deepgram/sdk");

const supabaseAdmin = require("./supabase");
const {
  createRoom,
  joinRoom,
  leaveRoom,
  getRoom,
  getProjectedRoomState,
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
const allowedRoles = new Set(["candidate", "hr", "super_admin"]);

async function getAuthenticatedUserFromToken(token) {
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    throw error || new Error("Invalid session");
  }
  return user;
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

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.split(" ")[1];
}

// Helper to broadcast projected room state based on roles
const broadcastProjectedRoomState = (roomId) => {
  if (!roomId) return;
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

// Socket Auth Middleware
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;

  if (!token) {
    return next(new Error("Authentication error: Token missing"));
  }
  
  try {
    const user = await getAuthenticatedUserFromToken(token);
    const authorizedRole = await getAuthorizedRole(user.id);

    socket.data.userId = user.id; 
    socket.data.email = user.email;
    socket.data.role = authorizedRole;
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
    const role = await getAuthorizedRole(user.id);
    res.json({ user: { id: user.id, email: user.email, role } });
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
});

app.get("/api/token", async (req, res) => {
  const channelName = req.query.channelName;
  if (!channelName) return res.status(400).json({ error: "channelName is required" });
  const uid = String(req.query.uid || "0");
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "No token provided" });

  let authorizedRole;
  try {
    const user = await getAuthenticatedUserFromToken(token);
    authorizedRole = await getAuthorizedRole(user.id);
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }

  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;
  
  const rtcRole = authorizedRole === "super_admin" ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;
  const agoraToken = RtcTokenBuilder.buildTokenWithAccount(appId, appCertificate, channelName, uid, rtcRole, Math.floor(Date.now() / 1000) + 3600);
  
  return res.json({ token: agoraToken, uid });
});

app.get("/api/rooms", async (req, res) => {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    const user = await getAuthenticatedUserFromToken(token);
    const role = await getAuthorizedRole(user.id);
    if (role !== "super_admin") {
      return res.status(403).json({ error: "Super Admin access required" });
    }
    const { getAllRooms } = require("./rooms");
    res.json({ rooms: getAllRooms() });
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
});

io.on("connection", (socket) => {
  console.log(`[Socket] Authorized: ${socket.id} as ${socket.data.role}`);

  socket.on("join-room", ({ roomId, userName, role }) => {
    const requestedRole = socket.data.role || "candidate";
    if (role && role !== requestedRole) {
      socket.emit("join-error", `Your account is authorized as ${requestedRole}, not ${role}.`);
      return;
    }
    const room = getRoom(roomId);
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
      const existingSocketId =
        requestedRole === "candidate"
          ? room.candidateUser?.id
          : requestedRole === "hr"
          ? room.hrUser?.id
          : Array.from(room.hiddenObservers.values()).find((observer) => observer.authUserId === socket.data.userId)?.id;

      if (existingSocketId && existingSocketId !== socket.id) {
        const existingSocket = io.sockets.sockets.get(existingSocketId);
        if (existingSocket) {
          existingSocket.leave(roomId);
          existingSocket.data.roomId = null;
        }
      }
    }

    socket.data.userName = userName;
    socket.data.roomId = roomId;
    socket.data.role = requestedRole;
    
    joinRoom(roomId, socket.id, userName, socket.data.userId, requestedRole);
    socket.join(roomId);
    
    broadcastProjectedRoomState(roomId);
  });

  socket.on("start-transcription", async ({ roomId }) => {
    if (socket.data.role !== "hr") {
      console.warn(`[Security] User ${socket.data.email} attempted to start transcription without HR role.`);
      return;
    }
    
    const room = getRoom(roomId);
    if (!room || room.state === "transcribing") return;

    room.state = "active";
    room.activeTranscriptionSession.isActive = false;
    room.activeTranscriptionSession.startedBy = socket.data.userId;
    room.activeTranscriptionSession.targetSpeakerId = room.candidateUser?.id;

    // Soft Recovery: Immediately insert the interview row
    try {
      const { data, error } = await supabaseAdmin
        .from('interviews')
        .insert([{
          room_id: roomId,
          hr_user_id: socket.data.userId,
          candidate_user_id: room.candidateUser?.authUserId || null,
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
    } catch (e) {
      console.error("[DB Catch] Error creating interview:", e);
    }

    io.to(roomId).emit("transcription-starting", { countdown: 10 });
    
    let countdown = 10;
    const interval = setInterval(() => {
      countdown--;
      io.to(roomId).emit("countdown-tick", { countdown });
      
      if (countdown <= 0) {
        clearInterval(interval);
        room.state = "transcribing";
        room.activeTranscriptionSession.isActive = true;
        room.activeTranscriptionSession.startedAt = Date.now();
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
            setupDeepgramEvents(dgConnection, roomId, room.candidateUser?.name || "Candidate", room.candidateUser?.id);
          } catch (err) {
            console.error("[Deepgram] Start failed:", err);
            dgState.isDeepgramConnecting = false;
            dgState.isDgOpen = false;
          }
        }
      }
    }, 1000);
  });

  socket.on("end-interview", async ({ roomId }) => {
    if (socket.data.role !== "hr" && socket.data.role !== "super_admin") return;
    
    const room = getRoom(roomId);
    if (!room) return;

    room.state = "ended";
    room.activeTranscriptionSession.isActive = false;
    finalizeAllActiveSpeakers(roomId);

    const dgState = activeDeepgramConnections.get(roomId);
    if (dgState && dgState.dgConnection) {
      try { dgState.dgConnection.requestClose(); } catch (e) {}
      activeDeepgramConnections.delete(roomId);
    }

    // Build flattened transcript
    const finalTranscript = room.blocks.map(b => `${b.speakerName}: ${b.content}`).join("\n\n");

    // Persist to Supabase
    if (room.interviewSessionId) {
      try {
        await supabaseAdmin
          .from('interviews')
          .update({
            status: 'completed',
            ended_at: new Date().toISOString(),
            final_transcript: finalTranscript
          })
          .eq('id', room.interviewSessionId);
          
        const formattedBlocks = room.blocks.map(b => ({
          id: b.id, // Assuming UUID is used for block ids now, or generate them
          interview_id: room.interviewSessionId,
          speaker: b.speakerName,
          content: b.content,
          confidence: 1.0, // simplified
          version: b.version,
          started_at: b.createdAt ? new Date(b.createdAt).toISOString() : new Date().toISOString(),
          ended_at: b.updatedAt ? new Date(b.updatedAt).toISOString() : new Date().toISOString()
        }));

        if (formattedBlocks.length > 0) {
          await supabaseAdmin.from('transcript_blocks').insert(formattedBlocks);
        }
        console.log(`[DB] Successfully persisted interview ${room.interviewSessionId}`);
      } catch (err) {
        console.error("[DB Error] Persistence failed:", err);
      }
    }

    io.to(roomId).emit("interview-ended");
    broadcastProjectedRoomState(roomId);
  });

  // STRICT PCM ROUTING AUTHORITY
  socket.on("audio-chunk", ({ roomId, audio }) => {
    const activeRoomId = roomId || socket.data.roomId;
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
      activeDeepgramConnections.delete(roomId);
    });

    dg.on(LiveTranscriptionEvents.Error, (err) => {
      console.error(`[Deepgram] Connection error for room ${roomId}:`, err);
      activeDeepgramConnections.delete(roomId);
    });
  }

  socket.on("toggle-mute", ({ roomId, isMuted }) => {
    toggleMute(roomId, socket.id, isMuted);
    broadcastProjectedRoomState(roomId);
  });

  socket.on("toggle-video", ({ roomId, isVideoEnabled }) => {
    toggleVideo(roomId, socket.id, isVideoEnabled);
    broadcastProjectedRoomState(roomId);
  });


  socket.on("transcript-edit", ({ roomId, blockId, content }) => {
    updateBlockContent(roomId, blockId, content);
    broadcastProjectedRoomState(roomId);
  });

  socket.on("clear-transcript", ({ roomId }) => {
    const room = getRoom(roomId);
    if (room) {
      room.blocks = [];
      room.activeSpeakers.clear();
      broadcastProjectedRoomState(roomId);
    }
  });

  socket.on("transcript-replace", ({ roomId, content }) => {
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
      broadcastProjectedRoomState(roomId);
    }
  });

  socket.on("leave-room", () => handleLeave(socket));
  socket.on("disconnect", () => {
    handleLeave(socket);
  });
});

function handleLeave(socket) {
  const roomId = socket.data.roomId;
  const role = socket.data.role;
  if (roomId) {
    const room = getRoom(roomId);
    if (room && role === "hr") {
      console.log(`[Socket] Interviewer (HR) left/disconnected room ${roomId}. Closing room.`);
      
      // Notify remaining participants in the room
      io.to(roomId).emit("room-closed", "The Interviewer (HR) has disconnected. The session is closed.");
      
      // Finalize and save blocks
      finalizeAllActiveSpeakers(roomId);
      const finalTranscript = room.blocks.map(b => `${b.speakerName}: ${b.content}`).join("\n\n");
      if (room.interviewSessionId) {
        supabaseAdmin
          .from('interviews')
          .update({
            status: 'completed',
            ended_at: new Date().toISOString(),
            final_transcript: finalTranscript
          })
          .eq('id', room.interviewSessionId)
          .then(() => console.log(`[DB] Successfully closed session on HR disconnect: ${room.interviewSessionId}`))
          .catch(err => console.error("[DB Error] HR disconnect persistence failed:", err));
      }
      
      // Clean up Deepgram connection
      const dgState = activeDeepgramConnections.get(roomId);
      if (dgState && dgState.dgConnection) {
        try { dgState.dgConnection.requestClose(); } catch (e) {}
        activeDeepgramConnections.delete(roomId);
      }
      
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

    finalizeAllActiveSpeakers(roomId);
    const updatedRoom = leaveRoom(roomId, socket.id);
    if (!updatedRoom) {
      const dgState = activeDeepgramConnections.get(roomId);
      if (dgState && dgState.dgConnection) {
        try { dgState.dgConnection.requestClose(); } catch (e) {}
        activeDeepgramConnections.delete(roomId);
      }
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
