// In-memory room and user management

const rooms = new Map();

function createRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      users: new Map(),
      transcripts: [],
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

function getRoomTranscripts(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return room.transcripts || [];
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

function addTranscript(roomId, transcript) {
  const room = rooms.get(roomId);
  if (room) {
    room.transcripts.push(transcript);
    // Keep last 500 transcripts per room
    if (room.transcripts.length > 500) {
      room.transcripts = room.transcripts.slice(-500);
    }
    return true;
  }
  return false;
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
  getRoomTranscripts,
  toggleMute,
  setSpeaking,
  addTranscript,
  findUserRoom,
};
