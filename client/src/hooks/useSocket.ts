"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";
import { RoomUser, TranscriptBlock } from "@/types";

let SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";
if (SOCKET_URL && !SOCKET_URL.startsWith("http://") && !SOCKET_URL.startsWith("https://")) {
  SOCKET_URL = `https://${SOCKET_URL}`;
}


export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const roomIdRef = useRef<string | null>(null);
  const userNameRef = useRef<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [blocks, setBlocks] = useState<TranscriptBlock[]>([]);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      autoConnect: true,
      withCredentials: true,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      console.log("[Socket] Connected:", socket.id);
      if (roomIdRef.current && userNameRef.current) {
        console.log("[Socket] Reconnected. Auto-rejoining room:", roomIdRef.current, "as", userNameRef.current);
        socket.emit("join-room", { roomId: roomIdRef.current, userName: userNameRef.current });
      }
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
      console.log("[Socket] Received room-state:", state);
      setUsers(state.users);
      setBlocks(state.blocks || []);
    });

    // Legacy speaking indicators - room-state or block-update will handle visual speaking states
    socket.on("user-speaking", ({ userId, isSpeaking }: { userId: string; isSpeaking: boolean }) => {
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, isSpeaking } : u))
      );
    });

    // Highly efficient targeted speaker block aggregation update with version ordering safety
    socket.on("block-update", (updatedBlock: TranscriptBlock) => {
      setBlocks((prev) => {
        const idx = prev.findIndex((b) => b.id === updatedBlock.id);
        if (idx >= 0) {
          // Version check: Ignore stale or duplicate updates
          if (updatedBlock.version <= prev[idx].version) {
            return prev;
          }
          const next = [...prev];
          next[idx] = updatedBlock;
          return next;
        }
        return [...prev, updatedBlock];
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const joinRoom = useCallback((roomId: string, userName: string) => {
    if (socketRef.current) {
      roomIdRef.current = roomId;
      userNameRef.current = userName;
      socketRef.current.emit("join-room", { roomId, userName });
      setCurrentRoomId(roomId);
    }
  }, []);

  const leaveRoom = useCallback(() => {
    if (socketRef.current) {
      roomIdRef.current = null;
      userNameRef.current = null;
      socketRef.current.emit("leave-room");
      setCurrentRoomId(null);
      setUsers([]);
      setBlocks([]);
    }
  }, []);

  const emitMuteToggle = useCallback((roomId: string, isMuted: boolean) => {
    if (socketRef.current) {
      // Align event with server listener "toggle-mute"
      socketRef.current.emit("toggle-mute", { roomId, isMuted });
    }
  }, []);

  const emitSpeaking = useCallback((roomId: string, isSpeaking: boolean) => {
    if (socketRef.current) {
      socketRef.current.emit("speaking", { roomId, isSpeaking });
    }
  }, []);

  const emitTranscriptEdit = useCallback((roomId: string, blockId: string, content: string) => {
    if (socketRef.current) {
      socketRef.current.emit("transcript-edit", { roomId, blockId, content });
    }
  }, []);

  return {
    socket: socketRef.current,
    socketId: socketRef.current?.id || null,
    isConnected,
    users,
    blocks,
    currentRoomId,
    joinRoom,
    leaveRoom,
    emitMuteToggle,
    emitSpeaking,
    emitTranscriptEdit,
  };
}

