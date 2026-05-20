"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";
import { RoomUser, TranscriptBlock } from "@/types";

let SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";
if (SOCKET_URL && !SOCKET_URL.startsWith("http://") && !SOCKET_URL.startsWith("https://")) {
  SOCKET_URL = `https://${SOCKET_URL}`;
}


export function useSocket(sessionToken?: string) {
  const socketRef = useRef<Socket | null>(null);
  const roomIdRef = useRef<string | null>(null);
  const userNameRef = useRef<string | null>(null);
  const roleRef = useRef<string>(typeof window !== "undefined" ? sessionStorage.getItem("intendedRole") || "candidate" : "candidate");
  const [socketId, setSocketId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [blocks, setBlocks] = useState<TranscriptBlock[]>([]);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [activeTranscriptionSession, setActiveTranscriptionSession] = useState<any>(null);

  useEffect(() => {
    if (!sessionToken) return;

    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      autoConnect: true,
      withCredentials: true,
      auth: { 
        token: sessionToken,
        role: typeof window !== "undefined" ? sessionStorage.getItem("intendedRole") || "candidate" : "candidate"
      },
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      setSocketId(socket.id ?? null);
      console.log("[Socket] Connected:", socket.id);
      if (roomIdRef.current && userNameRef.current) {
        console.log("[Socket] Reconnected. Auto-rejoining room:", roomIdRef.current, "as", userNameRef.current, "role:", roleRef.current);
        socket.emit("join-room", { roomId: roomIdRef.current, userName: userNameRef.current, role: roleRef.current });
      }
    });

    // NUCLEAR DEBUG: Log EVERY event that arrives
    socket.onAny((event, ...args) => {
      console.log(`[Socket EVENT]: ${event}`, args);
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
      setSocketId(null);
      console.log("[Socket] Disconnected");
    });

    socket.on("connect_error", (err) => {
      console.error(`[Socket] connect_error: ${err.message}`);
    });

    socket.on("room-state", (state) => {
      console.log("[Socket] Received room-state:", state);
      setUsers(state.users);
      setBlocks(state.blocks || []);
      if (state.activeTranscriptionSession) {
        setActiveTranscriptionSession(state.activeTranscriptionSession);
      }
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
  }, [sessionToken]);

  const joinRoom = useCallback((roomId: string, userName: string, role?: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (socketRef.current) {
        roomIdRef.current = roomId;
        userNameRef.current = userName;
        if (role) {
          roleRef.current = role;
        }

        const onRoomState = () => {
          socketRef.current?.off("room-state", onRoomState);
          socketRef.current?.off("join-error", onJoinError);
          resolve();
        };

        const onJoinError = (msg: string) => {
          socketRef.current?.off("room-state", onRoomState);
          socketRef.current?.off("join-error", onJoinError);
          roomIdRef.current = null;
          userNameRef.current = null;
          setCurrentRoomId(null);
          reject(new Error(msg));
        };

        socketRef.current.once("room-state", onRoomState);
        socketRef.current.once("join-error", onJoinError);

        socketRef.current.emit("join-room", { roomId, userName, role: roleRef.current });
        setCurrentRoomId(roomId);
      } else {
        reject(new Error("Socket not connected"));
      }
    });
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
    socketId,
    isConnected,
    users,
    blocks,
    currentRoomId,
    activeTranscriptionSession,
    joinRoom,
    leaveRoom,
    emitMuteToggle,
    emitSpeaking,
    emitTranscriptEdit,
    emitClearTranscript: useCallback(() => {
      if (socketRef.current) {
        socketRef.current.emit("clear-transcript", { roomId: roomIdRef.current });
      }
    }, []),
    emitTranscriptReplace: useCallback((content: string) => {
      if (socketRef.current) {
        socketRef.current.emit("transcript-replace", { roomId: roomIdRef.current, content });
      }
    }, []),
    emitStartTranscription: useCallback(() => {
      if (socketRef.current) {
        socketRef.current.emit("start-transcription", { roomId: roomIdRef.current });
      }
    }, []),
    emitStopTranscription: useCallback(() => {
      if (socketRef.current) {
        socketRef.current.emit("end-interview", { roomId: roomIdRef.current });
      }
    }, []),
  };
}

