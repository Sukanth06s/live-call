// In-memory room and user management

const rooms = new Map();
const supportedLanguages = new Set(["english", "tamil", "hindi"]);

function normalizeLanguage(language) {
  const normalized = String(language || "").trim().toLowerCase();
  return supportedLanguages.has(normalized) ? normalized : "english";
}

function createRoom(roomId, language = "english") {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      roomId: roomId,
      language: normalizeLanguage(language),
      interviewSessionId: null, // Set when HR starts the interview
      state: "waiting", // "waiting" | "active" | "transcribing" | "paused" | "hr_recovering" | "ending" | "ended"

      candidateUser: null,
      hrUser: null,
      lastCandidateUser: null,
      lastHrUser: null,
      hiddenObservers: new Map(), // socketId -> RoomUser

      activeTranscriptionSession: {
        isActive: false,
        startedBy: null,
        targetSpeakerId: null,
        startedAt: null
      },
      roomStateVersion: 0,

      blocks: [],                 // Array of TranscriptBlocks
      activeSpeakers: new Map(),  // userName -> { blockId, committedSegments, liveSegment }
      createdAt: Date.now(),

      // HR recovery metadata
      hrRecovery: {
        isRecovering: false,
        disconnectedAt: null,       // timestamp ms
        deadline: null,             // timestamp ms (disconnectedAt + 15000)
        disconnectedHrAuthUserId: null,
        disconnectedHrName: null,
      },
      priority: "normal",           // "normal" | "critical"
    });
  }
  return rooms.get(roomId);
}

function joinRoom(roomId, userId, userName, authUserId, role, agoraUid = null) {
  const room = createRoom(roomId);
  const existingUser =
    role === "candidate"
      ? room.candidateUser
      : role === "hr"
      ? room.hrUser
      : Array.from(room.hiddenObservers.values()).find((observer) => observer.authUserId === authUserId);

  const user = {
    id: userId,
    agoraUid,
    authUserId,
    name: userName,
    role,
    language: room.language,
    roomId,
    isMuted: existingUser?.isMuted ?? false,
    isVideoEnabled: existingUser?.isVideoEnabled ?? true,
    isSpeaking: existingUser?.isSpeaking ?? false,
    joinedAt: existingUser?.joinedAt ?? Date.now(),
  };

  if (role === "candidate") {
    room.candidateUser = user;
    room.lastCandidateUser = user;
  } else if (role === "hr") {
    room.hrUser = user;
    room.lastHrUser = user;
  } else if (role === "super_admin") {
    if (existingUser?.id && existingUser.id !== userId) {
      room.hiddenObservers.delete(existingUser.id);
    }
    room.hiddenObservers.set(userId, user);
  }

  return room;
}

// NOTE: Auto-delete on empty has been intentionally removed.
// Callers are responsible for calling deleteRoom() when appropriate.
// This is required so that hr_recovering rooms survive the grace period
// even when hrUser is null.
function leaveRoom(roomId, userId) {
  const room = rooms.get(roomId);
  if (room) {
    if (room.candidateUser?.id === userId) {
      room.lastCandidateUser = room.candidateUser;
      room.candidateUser = null;
    }
    if (room.hrUser?.id === userId) {
      room.lastHrUser = room.hrUser;
      room.hrUser = null;
    }
    room.hiddenObservers.delete(userId);
  }
  return room || null;
}

function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

function getAllRooms() {
  const activeRooms = [];
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    activeRooms.push({
      roomId: room.roomId,
      language: room.language,
      state: room.state,
      participantCount: (room.candidateUser ? 1 : 0) + (room.hrUser ? 1 : 0),
      isFull: Boolean(room.candidateUser && room.hrUser),
      candidateName: room.candidateUser?.name || room.lastCandidateUser?.name || null,
      hrName: room.hrUser?.name || room.lastHrUser?.name || null,
      createdAt: room.createdAt,
      priority: room.priority || "normal",
      hrRecovery: room.hrRecovery?.isRecovering
        ? {
            isRecovering: true,
            disconnectedHrName: room.hrRecovery.disconnectedHrName,
            remainingMs: Math.max(0, (room.hrRecovery.deadline || 0) - now),
          }
        : null,
    });
  }
  return activeRooms;
}

function getRoomsForRole(role, language = null) {
  const normalizedLanguage = language ? normalizeLanguage(language) : null;
  return getAllRooms()
    .filter((room) => {
      if (role === "hr") {
        const matchesLanguage = room.language === normalizedLanguage;
        // Show waiting rooms, recovering rooms, AND full ongoing rooms (any room with a candidate)
        return matchesLanguage && Boolean(room.candidateName);
      }
      if (role === "super_admin") {
        // Full rooms OR rooms in HR recovery mode
        return room.isFull || room.state === "hr_recovering";
      }
      return false;
    })
    .sort((a, b) => {
      // Critical (hr_recovering) rooms surface first
      if (a.priority === "critical" && b.priority !== "critical") return -1;
      if (b.priority === "critical" && a.priority !== "critical") return 1;
      return a.createdAt - b.createdAt;
    });
}

// Return the projected room state depending on who is asking
function getProjectedRoomState(roomId, requestorRole) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const now = Date.now();

  // Candidate and HR only see candidate and HR
  const visibleUsers = [];
  if (room.candidateUser) visibleUsers.push(room.candidateUser);
  if (room.hrUser) visibleUsers.push(room.hrUser);

  // Super admins see everyone including hidden observers
  if (requestorRole === "super_admin") {
    visibleUsers.push(...Array.from(room.hiddenObservers.values()));
  }

  return {
    roomId: room.roomId,
    language: room.language,
    interviewSessionId: room.interviewSessionId,
    state: room.state,
    users: visibleUsers,
    blocks: room.blocks,
    activeTranscriptionSession: room.activeTranscriptionSession,
    roomStateVersion: room.roomStateVersion,
    priority: room.priority || "normal",
    hrRecovery: room.hrRecovery?.isRecovering
      ? {
          isRecovering: true,
          disconnectedHrName: room.hrRecovery.disconnectedHrName,
          remainingMs: Math.max(0, (room.hrRecovery.deadline || 0) - now),
        }
      : null,
  };
}

function bumpRoomStateVersion(roomId) {
  const room = rooms.get(roomId);
  if (!room) return 0;
  room.roomStateVersion = (room.roomStateVersion || 0) + 1;
  return room.roomStateVersion;
}

// Get all socket IDs in a room, categorizing them for targeted broadcast
function getRoomSocketsByRole(roomId) {
  const room = rooms.get(roomId);
  if (!room) return { regular: [], superAdmin: [] };

  const regular = [];
  if (room.candidateUser) regular.push(room.candidateUser.id);
  if (room.hrUser) regular.push(room.hrUser.id);

  const superAdmin = Array.from(room.hiddenObservers.keys());

  return { regular, superAdmin };
}

function toggleMute(roomId, userId, isMuted) {
  const room = rooms.get(roomId);
  if (room) {
    if (room.candidateUser?.id === userId) room.candidateUser.isMuted = isMuted;
    else if (room.hrUser?.id === userId) room.hrUser.isMuted = isMuted;
    else if (room.hiddenObservers.has(userId)) room.hiddenObservers.get(userId).isMuted = isMuted;
    return true;
  }
  return false;
}

function toggleVideo(roomId, userId, isVideoEnabled) {
  const room = rooms.get(roomId);
  if (room) {
    if (room.candidateUser?.id === userId) room.candidateUser.isVideoEnabled = isVideoEnabled;
    else if (room.hrUser?.id === userId) room.hrUser.isVideoEnabled = isVideoEnabled;
    else if (room.hiddenObservers.has(userId)) room.hiddenObservers.get(userId).isVideoEnabled = isVideoEnabled;
    return true;
  }
  return false;
}


function setSpeaking(roomId, userId, isSpeaking) {
  const room = rooms.get(roomId);
  if (room) {
    if (room.candidateUser?.id === userId) room.candidateUser.isSpeaking = isSpeaking;
    else if (room.hrUser?.id === userId) room.hrUser.isSpeaking = isSpeaking;
    else if (room.hiddenObservers.has(userId)) room.hiddenObservers.get(userId).isSpeaking = isSpeaking;
    return true;
  }
  return false;
}

function addBlock(roomId, block) {
  const room = rooms.get(roomId);
  if (room) {
    room.blocks.push(block);
    // Keep last 500 blocks per room in memory
    if (room.blocks.length > 500) {
      room.blocks = room.blocks.slice(-500);
    }
    return true;
  }
  return false;
}

function updateBlockContent(roomId, blockId, content) {
  const room = rooms.get(roomId);
  if (room) {
    const block = room.blocks.find(b => b.id === blockId);
    if (block) {
      block.content = content;
      block.updatedAt = Date.now();
      block.version += 1;
      block.segments = [{
        text: content,
        isFinal: true,
        timestamp: Date.now(),
        confidence: 1.0
      }];
      return block;
    }
  }
  return null;
}

function findActiveSpeakerBlock(roomId, userName) {
  const room = rooms.get(roomId);
  if (room && room.activeSpeakers.has(userName)) {
    const buffer = room.activeSpeakers.get(userName);
    return room.blocks.find(b => b.id === buffer.blockId) || null;
  }
  return null;
}

function finalizeAllActiveSpeakers(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    for (const [userName, buffer] of room.activeSpeakers) {
      const block = room.blocks.find(b => b.id === buffer.blockId);
      if (block) {
        block.status = "final";
        block.isLive = false;
        block.isFinal = true;
        block.version += 1;
        block.updatedAt = Date.now();
        block.ended_at = new Date().toISOString();
      }
      room.activeSpeakers.delete(userName);
    }
  }
}

function findUserRoom(userId) {
  for (const [roomId, room] of rooms) {
    if (room.candidateUser?.id === userId ||
        room.hrUser?.id === userId ||
        room.hiddenObservers.has(userId)) {
      return roomId;
    }
  }
  return null;
}

function deleteRoom(roomId) {
  return rooms.delete(roomId);
}

module.exports = {
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
};
