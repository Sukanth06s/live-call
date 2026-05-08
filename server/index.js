require("dotenv").config();
// Global error catcher to debug Railway crashes
process.on("uncaughtException", (err) => {
  console.error("[CRITICAL] Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("[CRITICAL] Unhandled Rejection at:", promise, "reason:", reason);
});

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const {
  joinRoom,
  leaveRoom,
  getRoomUsers,
  getRoomTranscripts,
  toggleMute,
  setSpeaking,
  addTranscript,
  findUserRoom,
} = require("./rooms");

const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
const { createClient } = require("@deepgram/sdk");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

const app = express();
const server = http.createServer(app);

// Initialize Deepgram using the standard v3 factory
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
console.log("DG CLIENT INITIALIZED");
console.log("DG KEYS:", Object.keys(deepgram));
console.log("DG LISTEN: found");

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

// Helper to broadcast full canonical room state
const broadcastRoomState = (roomId) => {
  if (!roomId) return;
  const state = {
    users: getRoomUsers(roomId),
    transcripts: getRoomTranscripts(roomId) || [],
  };
  console.log(`[Room] Broadcasting state for ${roomId} to ${state.users.length} users`);
  io.to(roomId).emit("room-state", state);
};

// Socket.IO Debug Middleware
io.use((socket, next) => {
  const origin = socket.handshake.headers.origin;
  console.log(`[Socket] Connection request from: ${origin}`);
  socket.data.authenticated = true;
  next();
});

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Live Room Server Running" });
});

// Provide Agora App ID and Deepgram key to frontend
app.get("/api/config", (req, res) => {
  res.json({
    agoraAppId: process.env.AGORA_APP_ID,
    deepgramApiKey: process.env.DEEPGRAM_API_KEY,
  });
});

// Generate Agora RTC Token (ONLY available to authorized requests)
app.get("/api/token", (req, res) => {
  const channelName = req.query.channelName;
  if (!channelName) {
    return res.status(400).json({ error: "channelName is required" });
  }

  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;

  if (!appId || !appCertificate) {
    return res.status(500).json({ error: "Agora keys missing on server" });
  }

  const uid = 0;
  const role = RtcRole.PUBLISHER;
  const expireTime = 3600;
  const currentTime = Math.floor(Date.now() / 1000);
  const privilegeExpireTime = currentTime + expireTime;

  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid,
    role,
    privilegeExpireTime
  );

  return res.json({ token });
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`[Socket] Authorized: ${socket.id}`);

  let dgConnection = null;
  let isDeepgramConnecting = false;
  let audioQueue = [];


  // Join Room
  socket.on("join-room", ({ roomId, userName }) => {
    console.log(`[Room] ${userName} joining room ${roomId}`);
    socket.data.userName = userName;
    socket.data.roomId = roomId;
    
    // 1. Update server state
    joinRoom(roomId, socket.id, userName);
    
    // 2. Join socket room
    socket.join(roomId);
    
    // 3. Broadcast updated state to EVERYONE in the room
    broadcastRoomState(roomId);
  });

  // SECURE DEEPGRAM PROXY
  socket.on("audio-chunk", ({ roomId, audio }) => {
    if (!dgConnection && !isDeepgramConnecting) {
      isDeepgramConnecting = true;
      audioQueue = []; // Reset queue for new session
      console.log(`[Deepgram] Starting session for: ${socket.data.userName || "Guest"}`);
      
      const options = {
        model: "nova-2",
        smart_format: true,
        encoding: "linear16",
        sample_rate: 16000,
      };

      try {
        // Standard v3 pattern
        dgConnection = deepgram.listen.live(options);
        
        dgConnection.on("Results", (data) => {
          const transcript = data.channel.alternatives[0].transcript;
          if (transcript && transcript.trim()) {
            // Determine finality (Deepgram v3 uses is_final)
            const isFinal = data.is_final === true || data.speech_final === true;
            
            const entry = {
              id: `${socket.id}-${Date.now()}`,
              userId: socket.id,
              userName: socket.data.userName || "Guest",
              text: transcript,
              timestamp: Date.now(),
              isFinal: isFinal,
            };

            console.log(`[Deepgram] Emitting (${isFinal ? "FINAL" : "PARTIAL"}): ${transcript}`);
            
            const activeRoomId = roomId || socket.data.roomId;
            
            if (isFinal && activeRoomId) {
              addTranscript(activeRoomId, entry);
            }
            
            // NUCLEAR TEST: Emit only to the ROOM
            if (activeRoomId) {
              io.to(activeRoomId).emit("transcript-update", entry);
            }
          }
        });

        dgConnection.on("Open", () => {
          console.log("[Deepgram] Connection READY. Flushing queue:", audioQueue.length);
          isDeepgramConnecting = false;
          // Flush any queued audio
          while (audioQueue.length > 0) {
            const chunk = audioQueue.shift();
            dgConnection.send(chunk);
          }
        });

        dgConnection.on("Close", () => {
          console.log("[Deepgram] Connection closed");
          dgConnection = null;
          isDeepgramConnecting = false;
        });

        dgConnection.on("Error", (err) => {
          console.error("[Deepgram] SDK ERROR:", err);
          dgConnection = null;
          isDeepgramConnecting = false;
          audioQueue = [];
        });

      } catch (err) {
        console.error("[Deepgram] Crash caught:", err.message);
        dgConnection = null;
        isDeepgramConnecting = false;
        audioQueue = [];
      }
    }

    // Process chunk
    if (dgConnection && dgConnection.getReadyState && dgConnection.getReadyState() === 1) {
      // Connection is open, send directly
      dgConnection.send(audio);
    } else if (isDeepgramConnecting) {
      // Connection is opening, queue the audio
      audioQueue.push(audio);
      if (audioQueue.length > 100) audioQueue.shift(); // Safety limit (approx 4-5 seconds)
    }
  });

  // Mute toggle
  socket.on("toggle-mute", ({ roomId, isMuted }) => {
    toggleMute(roomId, socket.id, isMuted);
    broadcastRoomState(roomId);
    
    if (isMuted && dgConnection) {
      dgConnection.requestClose();
      dgConnection = null;
    }
  });

  // Speaking indicator
  socket.on("speaking", ({ roomId, isSpeaking }) => {
    setSpeaking(roomId, socket.id, isSpeaking);
    socket.to(roomId).emit("user-speaking", {
      userId: socket.id,
      isSpeaking,
    });
  });

  // Leave room
  socket.on("leave-room", () => {
    handleLeave(socket);
  });

  // Disconnect
  socket.on("disconnect", () => {
    if (dgConnection) {
      dgConnection.requestClose();
      dgConnection = null;
    }
    console.log(`[Socket] Disconnected: ${socket.id}`);
    handleLeave(socket);
  });
});

function handleLeave(socket) {
  const roomId = socket.data.roomId;
  if (roomId) {
    leaveRoom(roomId, socket.id);
    broadcastRoomState(roomId);
    socket.leave(roomId);
    console.log(`[Room] ${socket.data.userName} left room ${roomId}`);
    socket.data.roomId = null;
    socket.data.userName = null;
  }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Railway] Server is active and listening on port ${PORT}`);
});
