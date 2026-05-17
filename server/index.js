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
  getRoomBlocks,
  toggleMute,
  setSpeaking,
  addBlock,
  updateBlockContent,
  findActiveSpeakerBlock,
  finalizeAllActiveSpeakers,
  findUserRoom,
  getRoom,
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

// Global Silence Timeout Registry
const speakerTimeouts = new Map(); // key: `${roomId}-${userName}` -> Timeout

// Helper to broadcast full canonical room state
const broadcastRoomState = (roomId) => {
  if (!roomId) return;
  const state = {
    users: getRoomUsers(roomId),
    blocks: getRoomBlocks(roomId) || [],
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
    
    // 3. Broadcast updated state to EVERYONE in the room (low-frequency boundary)
    broadcastRoomState(roomId);
  });

  // SECURE DEEPGRAM PROXY & TURN ENGINE
  socket.on("audio-chunk", ({ roomId, audio, sampleRate }) => {
    if (audio) {
      console.log("[PCM RECEIVED]", audio.byteLength);
    }

    const activeRoomId = roomId || socket.data.roomId;
    const userName = socket.data.userName || "Guest";
    const speakerId = socket.id;

    if (!dgConnection && !isDeepgramConnecting) {
      isDeepgramConnecting = true;
      audioQueue = []; // Reset queue for new session
      const streamSampleRate = sampleRate || 16000;
      console.log(`[Deepgram] Starting session for: ${userName} at sampleRate: ${streamSampleRate}Hz`);
      
      const options = {
        model: "nova-2",
        smart_format: true,
        encoding: "linear16",
        sample_rate: streamSampleRate,
      };

      try {
        // Standard v3 pattern
        dgConnection = deepgram.listen.live(options);
        
        dgConnection.on("Results", (data) => {
          console.log("[DEEPGRAM EVENT - RESULTS]", JSON.stringify(data.channel.alternatives[0]));
          const transcript = data.channel.alternatives[0].transcript;
          const confidence = data.channel.alternatives[0].confidence || 1.0;
          
          if (transcript && transcript.trim() && activeRoomId) {
            const isFinal = data.is_final === true || data.speech_final === true;
            const room = getRoom(activeRoomId);
            if (!room) return;

            // 1. Interruption Check:
            // Finalize any active live block belonging to OTHER speakers immediately
            for (const [otherUserName, otherBuffer] of room.activeSpeakers) {
              if (otherUserName !== userName) {
                const otherTimeoutKey = `${activeRoomId}-${otherUserName}`;
                if (speakerTimeouts.has(otherTimeoutKey)) {
                  clearTimeout(speakerTimeouts.get(otherTimeoutKey));
                  speakerTimeouts.delete(otherTimeoutKey);
                }

                const otherBlock = room.blocks.find(b => b.id === otherBuffer.blockId);
                if (otherBlock) {
                  otherBlock.status = "final";
                  otherBlock.isLive = false;
                  otherBlock.isFinal = true;
                  otherBlock.version += 1;
                  otherBlock.updatedAt = Date.now();

                  console.log(`[Turn Engine] Interruption: Finalizing ${otherUserName}'s block due to ${userName}`);
                  io.to(activeRoomId).emit("block-update", otherBlock);
                }
                room.activeSpeakers.delete(otherUserName);
              }
            }

            // 2. Live Block Creation:
            // Instantiate a new TranscriptBlock if no active turn is registered
            if (!room.activeSpeakers.has(userName)) {
              const blockId = `block-${activeRoomId}-${userName}-${Date.now()}`;
              const newBlock = {
                id: blockId,
                speakerId: speakerId,
                speakerName: userName,
                content: "",
                segments: [],
                status: "live",
                isLive: true,
                isFinal: false,
                version: 1,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                editableBy: [userName],
                roomId: activeRoomId
              };

              addBlock(activeRoomId, newBlock);

              room.activeSpeakers.set(userName, {
                blockId: blockId,
                committedSegments: [],
                liveSegment: null
              });

              console.log(`[Turn Engine] Created new live block ${blockId} for ${userName}`);
            }

            // 3. Live Text Segment Aggregation:
            const buffer = room.activeSpeakers.get(userName);
            const block = room.blocks.find(b => b.id === buffer.blockId);

            if (block) {
              const segment = {
                text: transcript.trim(),
                isFinal: isFinal,
                timestamp: Date.now(),
                confidence: confidence
              };

              if (!isFinal) {
                buffer.liveSegment = segment;
                block.segments = [...buffer.committedSegments, buffer.liveSegment];
              } else {
                buffer.committedSegments.push(segment);
                buffer.liveSegment = null;
                block.segments = buffer.committedSegments;
              }

              // Compile card content cache (increment version to reconcile out-of-order client packets)
              block.content = block.segments.map(s => s.text).join(" ");
              block.updatedAt = Date.now();
              block.version += 1;

              console.log(`[Turn Engine] Emitting card update for ${userName} (${isFinal ? "FINAL" : "PARTIAL"}): ${block.content}`);
              io.to(activeRoomId).emit("block-update", block);

              // 4. Silence Segmentation (Out-of-band Timeout Registry):
              if (isFinal) {
                const timeoutKey = `${activeRoomId}-${userName}`;

                if (speakerTimeouts.has(timeoutKey)) {
                  clearTimeout(speakerTimeouts.get(timeoutKey));
                }

                const timer = setTimeout(() => {
                  const finalBlock = room.blocks.find(b => b.id === buffer.blockId);
                  if (finalBlock) {
                    finalBlock.status = "final";
                    finalBlock.isLive = false;
                    finalBlock.isFinal = true;
                    finalBlock.version += 1;
                    finalBlock.updatedAt = Date.now();

                    console.log(`[Turn Engine] Silence timeout fired. Finalizing block ${buffer.blockId} for ${userName}`);
                    io.to(activeRoomId).emit("block-update", finalBlock);
                  }
                  room.activeSpeakers.delete(userName);
                  speakerTimeouts.delete(timeoutKey);
                }, 2000);

                speakerTimeouts.set(timeoutKey, timer);
              }
            }
          }
        });

        dgConnection.on("Open", () => {
          console.log("[DEEPGRAM EVENT - OPEN]. Flushing queue:", audioQueue.length);
          isDeepgramConnecting = false;
          // Flush any queued audio
          while (audioQueue.length > 0) {
            const chunk = audioQueue.shift();
            console.log("[PCM TO DG - FLUSH]", chunk.byteLength);
            dgConnection.send(chunk);
          }
        });

        dgConnection.on("Close", () => {
          console.log("[DEEPGRAM EVENT - CLOSE]");
          dgConnection = null;
          isDeepgramConnecting = false;
        });

        dgConnection.on("Error", (err) => {
          console.error("[DEEPGRAM EVENT - ERROR]:", err);
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
      console.log("[PCM TO DG]", audio.byteLength);
      dgConnection.send(audio);
    } else if (isDeepgramConnecting) {
      console.log("[PCM QUEUED]", audio.byteLength);
      audioQueue.push(audio);
      if (audioQueue.length > 100) audioQueue.shift(); // Safety limit (approx 4-5 seconds)
    }
  });

  // Mute toggle (Commit and finalize active blocks immediately)
  socket.on("toggle-mute", ({ roomId, isMuted }) => {
    toggleMute(roomId, socket.id, isMuted);
    broadcastRoomState(roomId);
    
    const userName = socket.data.userName;
    if (isMuted && userName && roomId) {
      const timeoutKey = `${roomId}-${userName}`;
      if (speakerTimeouts.has(timeoutKey)) {
        clearTimeout(speakerTimeouts.get(timeoutKey));
        speakerTimeouts.delete(timeoutKey);
      }

      const room = getRoom(roomId);
      if (room && room.activeSpeakers.has(userName)) {
        const buffer = room.activeSpeakers.get(userName);
        const block = room.blocks.find(b => b.id === buffer.blockId);
        if (block) {
          block.status = "final";
          block.isLive = false;
          block.isFinal = true;
          block.version += 1;
          block.updatedAt = Date.now();
          io.to(roomId).emit("block-update", block);
        }
        room.activeSpeakers.delete(userName);
      }
    }

    if (isMuted && dgConnection) {
      dgConnection.requestClose();
      dgConnection = null;
    }
  });

  // Manual transcript edits (Strict permission and state validation)
  socket.on("transcript-edit", ({ roomId, blockId, content }) => {
    const userName = socket.data.userName;
    if (!roomId || !blockId || !userName) return;

    const room = getRoom(roomId);
    if (!room) return;

    const block = room.blocks.find(b => b.id === blockId);
    if (!block) return;

    // Validate block is finalized
    if (block.status !== "final") {
      console.log(`[Edit Guard] Block ${blockId} is not finalized yet.`);
      return;
    }

    // Validate ownership permission
    if (!block.editableBy.includes(userName)) {
      console.log(`[Edit Guard] Permission denied for ${userName} to edit ${blockId}.`);
      return;
    }

    // Perform the edit and increment version
    updateBlockContent(roomId, blockId, content);
    console.log(`[Turn Engine] User ${userName} edited block ${blockId} content to: ${content}`);
    
    // Broadcast the updated state to keep all room clients in sync (low-frequency action)
    broadcastRoomState(roomId);
  });

  // Speaking indicator (legacy, kept for compatibility if needed)
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
  const userName = socket.data.userName;
  if (roomId) {
    // 1. Clean up timeouts
    if (userName) {
      const timeoutKey = `${roomId}-${userName}`;
      if (speakerTimeouts.has(timeoutKey)) {
        clearTimeout(speakerTimeouts.get(timeoutKey));
        speakerTimeouts.delete(timeoutKey);
      }

      // 2. Finalize any active speech turn block
      const room = getRoom(roomId);
      if (room && room.activeSpeakers.has(userName)) {
        const buffer = room.activeSpeakers.get(userName);
        const block = room.blocks.find(b => b.id === buffer.blockId);
        if (block) {
          block.status = "final";
          block.isLive = false;
          block.isFinal = true;
          block.version += 1;
          block.updatedAt = Date.now();
        }
        room.activeSpeakers.delete(userName);
      }
    }

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

