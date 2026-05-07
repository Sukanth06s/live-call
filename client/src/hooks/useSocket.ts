"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";
import { RoomUser, TranscriptEntry } from "@/types";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["polling", "websocket"], // Polling first for better compatibility
      autoConnect: true,
      withCredentials: true,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      console.log("[Socket] Connected:", socket.id);
    });

    // NUCLEAR DEBUG: Log EVERY event that arrives
    socket.onAny((event, ...args) => {
      console.log(`[Socket EVENT]: ${event}`, args);
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
      console.log("[Socket] Disconnected");
    });

    socket.on("room-state", (state) => {
      setUsers(state.users);
      setTranscripts(state.transcripts || []);
    });

    socket.on("user-joined", ({ users }: { users: RoomUser[] }) => {
      setUsers(users);
    });

    socket.on("user-left", ({ userId }: { userId: string }) => {
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    });

    socket.on("user-muted", ({ userId, isMuted }: { userId: string; isMuted: boolean }) => {
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, isMuted } : u))
      );
    });

    socket.on("user-speaking", ({ userId, isSpeaking }: { userId: string; isSpeaking: boolean }) => {
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, isSpeaking } : u))
      );
    });

    socket.on("transcript-update", (entry: TranscriptEntry) => {
      setTranscripts((prev) => {
        // De-duplicate final transcripts with same text and near-identical timestamp
        if (entry.isFinal) {
          const isDuplicate = prev.some(
            (t) => t.isFinal && t.text === entry.text && Math.abs(t.timestamp - entry.timestamp) < 2000
          );
          if (isDuplicate) return prev;
        }

        // If it's a partial update, replace existing partial from same user
        if (!entry.isFinal) {
          const existingIdx = prev.findIndex(
            (t) => t.userId === entry.userId && !t.isFinal
          );
          if (existingIdx >= 0) {
            const next = [...prev];
            next[existingIdx] = entry;
            return next;
          }
          return [...prev, entry];
        }
        // Final transcript: remove any partial from same user and add final
        const filtered = prev.filter(
          (t) => !(t.userId === entry.userId && !t.isFinal)
        );
        return [...filtered, entry];
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const joinRoom = useCallback((roomId: string, userName: string) => {
    if (socketRef.current) {
      socketRef.current.emit("join-room", { roomId, userName });
      setCurrentRoomId(roomId);
    }
  }, []);

  const leaveRoom = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.emit("leave-room");
      setCurrentRoomId(null);
      setUsers([]);
      setTranscripts([]);
    }
  }, []);

  const emitTranscript = useCallback((roomId: string, transcript: string, isFinal: boolean) => {
    if (socketRef.current) {
      socketRef.current.emit("transcript", { roomId, transcript, isFinal });
    }
  }, []);

  const emitMuteToggle = useCallback((roomId: string, isMuted: boolean) => {
    if (socketRef.current) {
      socketRef.current.emit("mute-toggle", { roomId, isMuted });
    }
  }, []);

  const emitSpeaking = useCallback((roomId: string, isSpeaking: boolean) => {
    if (socketRef.current) {
      socketRef.current.emit("speaking", { roomId, isSpeaking });
    }
  }, []);

  return {
    socket: socketRef.current,
    socketId: socketRef.current?.id || null,
    isConnected,
    users,
    transcripts,
    currentRoomId,
    joinRoom,
    leaveRoom,
    emitTranscript,
    emitMuteToggle,
    emitSpeaking,
  };
}
