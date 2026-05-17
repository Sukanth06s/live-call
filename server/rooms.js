// In-memory room and user management

const rooms = new Map();

function createRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      users: new Map(),
      blocks: [],                 // Array of TranscriptBlocks
      activeSpeakers: new Map(),  // userName -> { blockId, committedSegments, liveSegment }
      createdAt: Date.now(),
    });
  }
  return rooms.get(roomId);
}

function joinRoom(roomId, userId, userName) {
  const room = createRoom(roomId);
  room.users.set(userId, {
    id: userId,
    name: userName,
    isMuted: false,
    isSpeaking: false,
    joinedAt: Date.now(),
  });
  return room;
}

function leaveRoom(roomId, userId) {
  const room = rooms.get(roomId);
  if (room) {
    room.users.delete(userId);
    // Clean up empty rooms
    if (room.users.size === 0) {
      rooms.delete(roomId);
      return null;
    }
  }
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

function getRoomUsers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.users.values());
}

function getRoomBlocks(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return room.blocks || [];
}

function toggleMute(roomId, userId, isMuted) {
  const room = rooms.get(roomId);
  if (room && room.users.has(userId)) {
    room.users.get(userId).isMuted = isMuted;
    return true;
  }
  return false;
}

function setSpeaking(roomId, userId, isSpeaking) {
  const room = rooms.get(roomId);
  if (room && room.users.has(userId)) {
    room.users.get(userId).isSpeaking = isSpeaking;
    return true;
  }
  return false;
}

function addBlock(roomId, block) {
  const room = rooms.get(roomId);
  if (room) {
    room.blocks.push(block);
    // Keep last 500 blocks per room to prevent memory overflow
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
      // Overwrite segment list with a single finalized edit segment
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
      }
      room.activeSpeakers.delete(userName);
    }
  }
}

function findUserRoom(userId) {
  for (const [roomId, room] of rooms) {
    if (room.users.has(userId)) {
      return roomId;
    }
  }
  return null;
}

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  getRoom,
  getRoomUsers,
  getRoomBlocks,
  toggleMute,
  setSpeaking,
  addBlock,
  updateBlockContent,
  findActiveSpeakerBlock,
  finalizeAllActiveSpeakers,
  findUserRoom,
};

