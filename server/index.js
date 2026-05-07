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

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

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

// Generate Agora RTC Token
app.get("/api/token", (req, res) => {
  const channelName = req.query.channelName;
  if (!channelName) {
    return res.status(400).json({ error: "channelName is required" });
  }

  let uid = req.query.uid || 0;
  let role = RtcRole.PUBLISHER;
  let expireTime = req.query.expiry || 3600;
  const currentTime = Math.floor(Date.now() / 1000);
  const privilegeExpireTime = currentTime + Number(expireTime);

  const token = RtcTokenBuilder.buildTokenWithUid(
    process.env.AGORA_APP_ID,
    process.env.AGORA_APP_CERTIFICATE,
    channelName,
    uid,
    role,
    privilegeExpireTime
  );

  return res.json({ token });
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // Join room
  socket.on("join-room", ({ roomId, userName }) => {
    if (!roomId || !userName) {
      socket.emit("error", { message: "Room ID and username are required" });
      return;
    }

    const user = { id: socket.id, name: userName };
    const room = joinRoom(roomId, user);

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userName = userName;

    console.log(`[Room] ${userName} joined room ${roomId}`);

    // Send current room state to the joining user
    socket.emit("room-state", {
      roomId,
      users: getRoomUsers(roomId),
      transcripts: room.transcripts.slice(-100), // Send last 100 transcripts
    });

    // Notify others in the room
    socket.to(roomId).emit("user-joined", {
      id: socket.id,
      name: userName,
      isMuted: false,
      isSpeaking: false,
      joinedAt: Date.now(),
    });
  });

  // Transcript event
  socket.on("transcript", ({ roomId, transcript, isFinal }) => {
    const entry = {
      id: `${socket.id}-${Date.now()}`,
      userId: socket.id,
      userName: socket.data.userName || "Unknown",
      text: transcript,
      isFinal,
      timestamp: Date.now(),
    };

    if (isFinal && transcript.trim()) {
      addTranscript(roomId, entry);
    }

    // Broadcast to ALL users in the room (including sender for sync)
    io.in(roomId).emit("transcript", entry);
  });

  // Mute toggle
  socket.on("mute-toggle", ({ roomId, isMuted }) => {
    toggleMute(roomId, socket.id, isMuted);
    socket.to(roomId).emit("user-mute-toggle", {
      userId: socket.id,
      isMuted,
    });
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
server.listen(PORT, () => {
  console.log(`\n🚀 Live Room Server running on http://localhost:${PORT}\n`);
});
