require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const {
  joinRoom,
  leaveRoom,
  getRoomUsers,
  toggleMute,
  setSpeaking,
  addTranscript,
  findUserRoom,
} = require("./rooms");

const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
const { DeepgramClient } = require("@deepgram/sdk");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

const app = express();
const server = http.createServer(app);

// Initialize Deepgram using the direct Client constructor (v5+ standard)
const deepgram = new DeepgramClient(process.env.DEEPGRAM_API_KEY);

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

  // Join room
  socket.on("join-room", ({ roomId, userName }) => {
    socket.data.userName = userName;
    
    const user = { id: socket.id, name: userName };
    joinRoom(roomId, user);

    socket.join(roomId);
    socket.data.roomId = roomId;

    console.log(`[Room] ${userName} joined ${roomId}`);

    io.to(roomId).emit("user-joined", {
      users: getRoomUsers(roomId),
    });
  });

  // SECURE DEEPGRAM PROXY: Handle audio chunks from client
  socket.on("audio-chunk", ({ roomId, audio }) => {
    if (!dgConnection) {
      console.log(`[Deepgram] Starting secure session for ${socket.id}`);
      dgConnection = deepgram.listen.live.createConnection({
        model: "nova-2",
        smart_format: true,
        encoding: "linear16",
        sample_rate: 16000,
      });

      dgConnection.on("transcript", (data) => {
        const transcript = data.channel.alternatives[0].transcript;
        if (transcript && transcript.trim()) {
          const entry = {
            id: `${socket.id}-${Date.now()}`,
            userId: socket.id,
            userName: socket.data.userName || "Unknown",
            text: transcript,
            timestamp: Date.now(),
            isFinal: data.is_final,
          };

          if (data.is_final) {
            addTranscript(roomId, entry);
          }

          io.to(roomId).emit("transcript", entry);
        }
      });

      dgConnection.on("error", (err) => {
        console.error(`[Deepgram] Error:`, err);
      });
    }

    if (dgConnection && audio) {
      dgConnection.send(audio);
    }
  });

  // Mute toggle
  socket.on("toggle-mute", ({ roomId, isMuted }) => {
    toggleMute(roomId, socket.id, isMuted);
    io.to(roomId).emit("user-muted", { userId: socket.id, isMuted });
    
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
    socket.to(roomId).emit("user-left", { userId: socket.id });
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
