"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";
import { ActiveTranscriptionSession, InterviewState, RoomLanguage, RoomState, RoomUser, TranscriptBlock } from "@/types";
import { formatIstDateTime } from "@/lib/time";

let SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";
if (SOCKET_URL && !SOCKET_URL.startsWith("http://") && !SOCKET_URL.startsWith("https://")) {
  SOCKET_URL = `https://${SOCKET_URL}`;
}


export function useSocket(sessionToken?: string, onAuthError?: (message: string) => void) {
  const socketRef = useRef<Socket | null>(null);
  const roomIdRef = useRef<string | null>(null);
  const userNameRef = useRef<string | null>(null);
  const roleRef = useRef<string>(typeof window !== "undefined" ? sessionStorage.getItem("intendedRole") || "candidate" : "candidate");
  const sessionTokenRef = useRef<string | undefined>(undefined);
  const roomStateVersionRef = useRef(0);
  const [socketInstance, setSocketInstance] = useState<Socket | null>(null);
  const [socketId, setSocketId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [blocks, setBlocks] = useState<TranscriptBlock[]>([]);
  const [roomState, setRoomState] = useState<InterviewState | null>(null);
  const [activeTranscriptionSession, setActiveTranscriptionSession] = useState<ActiveTranscriptionSession | null>(null);
  const [transcriptSaveStatus, setTranscriptSaveStatus] = useState<string | null>(null);
  const [isTranscriptionChanging, setIsTranscriptionChanging] = useState(false);
  const [transcriptionCountdown, setTranscriptionCountdown] = useState<number | null>(null);
  const [hrRecovery, setHrRecovery] = useState<{
    isRecovering: boolean;
    message: string;
    remainingMs: number;
    deadline: number;
  } | null>(null);

  const [candidateRecovery, setCandidateRecovery] = useState<{
    isRecovering: boolean;
    message: string;
    remainingMs: number;
    deadline: number;
    isTimeout: boolean;
  } | null>(null);

  useEffect(() => {
    if (!sessionToken) return;
    if (sessionTokenRef.current !== sessionToken) {
      sessionTokenRef.current = sessionToken;
      roomIdRef.current = null;
      userNameRef.current = null;
      roleRef.current = "candidate";
      setSocketId(null);
      setIsConnected(false);
      setUsers([]);
      setBlocks([]);
      setRoomState(null);
      setActiveTranscriptionSession(null);
      setTranscriptSaveStatus(null);
      setIsTranscriptionChanging(false);
      setTranscriptionCountdown(null);
      setHrRecovery(null);
      setCandidateRecovery(null);
      roomStateVersionRef.current = 0;
    }

    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      autoConnect: true,
      withCredentials: true,
      auth: { 
        token: sessionToken,
      },
    });

    socketRef.current = socket;
    socket.on("connect", () => {
      setSocketInstance(socket);
      setIsConnected(true);
      setSocketId(socket.id ?? null);
      console.log("[Socket] Connected:", socket.id);
      if (roomIdRef.current && userNameRef.current) {
        console.log("[Socket] Reconnected. Auto-rejoining room:", roomIdRef.current, "as", userNameRef.current, "role:", roleRef.current);
        socket.emit("join-room", { roomId: roomIdRef.current, userName: userNameRef.current, role: roleRef.current });
      }
    });

    socket.on("disconnect", () => {
      setSocketInstance(null);
      setIsConnected(false);
      setSocketId(null);
      console.log("[Socket] Disconnected");
    });

    socket.on("connect_error", (err) => {
      console.error(`[Socket] connect_error: ${err.message}`);
      if (err.message.toLowerCase().includes("invalid token")) {
        socket.disconnect();
        onAuthError?.("Your session has expired. Please sign in again.");
      }
    });

    socket.on("room-state", (state: RoomState) => {
      if (roomIdRef.current && state.roomId !== roomIdRef.current) {
        return;
      }
      const version = state.roomStateVersion || 0;
      if (version && version <= roomStateVersionRef.current) {
        return;
      }
      if (version) roomStateVersionRef.current = version;

      console.log("[Socket] Received room-state:", state);
      setUsers(state.users);
      setBlocks(state.blocks || []);
      setRoomState(state.state ?? null);
      if (state.activeTranscriptionSession) {
        setActiveTranscriptionSession(state.activeTranscriptionSession);
      }
      if (state.activeTranscriptionSession?.isActive || state.state === "paused" || state.state === "ended" || state.state === "waiting") {
        setIsTranscriptionChanging(false);
        setTranscriptionCountdown(null);
      }
      // Sync hrRecovery from room-state broadcast
      if (state.hrRecovery?.isRecovering) {
        setHrRecovery({
          isRecovering: true,
          message: "Your interviewer has disconnected. Please wait — we're finding an interviewer for you.",
          remainingMs: state.hrRecovery.remainingMs ?? 15000,
          deadline: state.hrRecovery.deadline ?? Date.now() + 15000,
        });
      } else {
        setHrRecovery(null);
      }

      // Sync candidateRecovery from room-state broadcast
      if (state.candidateRecovery?.isRecovering) {
        setCandidateRecovery((prev) => ({
          isRecovering: true,
          message: "Candidate has disconnected. Waiting for them to reconnect...",
          remainingMs: state.candidateRecovery!.remainingMs ?? 60000,
          deadline: state.candidateRecovery!.deadline ?? Date.now() + (state.candidateRecovery!.remainingMs ?? 60000),
          isTimeout: prev?.isTimeout || false,
        }));
      } else if (state.state === "candidate_recovering") {
        setCandidateRecovery((prev) => ({
          isRecovering: true,
          message: prev?.message || "Candidate has disconnected. Waiting for them to reconnect...",
          remainingMs: prev?.remainingMs ?? 60000,
          deadline: prev?.deadline ?? Date.now() + 60000,
          isTimeout: prev?.isTimeout || false,
        }));
      } else if (!state.candidateRecovery && state.state !== "waiting_for_candidate") {
        setCandidateRecovery((prev) => (prev?.isTimeout ? prev : null));
      }

      if (state.state === "waiting_for_candidate") {
        setCandidateRecovery(null);
      }
    });

    socket.on("transcription-starting", ({ countdown }: { countdown: number }) => {
      setIsTranscriptionChanging(true);
      setTranscriptionCountdown(countdown);
    });

    socket.on("countdown-tick", ({ countdown }: { countdown: number }) => {
      setIsTranscriptionChanging(countdown > 0);
      setTranscriptionCountdown(countdown > 0 ? countdown : null);
    });

    socket.on("transcription-stopped", () => {
      setIsTranscriptionChanging(false);
      setTranscriptionCountdown(null);
    });

    socket.on("interview-ended", () => {
      setIsTranscriptionChanging(false);
      setTranscriptionCountdown(null);
    });

    // HR Recovery events
    socket.on("hr-recovering", ({ message, remainingMs, deadline }: { message: string; remainingMs: number; deadline: number }) => {
      console.log("[Socket] hr-recovering:", message, remainingMs);
      setHrRecovery({ isRecovering: true, message, remainingMs, deadline });
    });

    socket.on("hr-recovery-tick", ({ remainingMs }: { remainingMs: number }) => {
      setHrRecovery((prev) => prev ? { ...prev, remainingMs } : null);
    });

    socket.on("hr-rejoined", ({ message }: { message: string }) => {
      console.log("[Socket] hr-rejoined:", message);
      setHrRecovery(null);
    });

    // Candidate Recovery events
    socket.on("candidate-recovering", ({ message, remainingMs, deadline }: { message: string; remainingMs: number; deadline: number }) => {
      console.log("[Socket] candidate-recovering:", message, remainingMs);
      setCandidateRecovery({ isRecovering: true, message, remainingMs, deadline, isTimeout: false });
    });

    socket.on("candidate-recovery-tick", ({ remainingMs }: { remainingMs: number }) => {
      setCandidateRecovery((prev) => {
        if (prev?.isRecovering) return { ...prev, remainingMs };
        return {
          isRecovering: true,
          message: "Candidate has disconnected. Waiting for them to reconnect...",
          remainingMs,
          deadline: Date.now() + remainingMs,
          isTimeout: false,
        };
      });
    });

    socket.on("candidate-recovery-timeout", () => {
      console.log("[Socket] candidate-recovery-timeout");
      setCandidateRecovery((prev) =>
        prev
          ? { ...prev, isRecovering: false, isTimeout: true, remainingMs: 0 }
          : {
              isRecovering: false,
              isTimeout: true,
              message: "Candidate has disconnected. Waiting for them to reconnect...",
              remainingMs: 0,
              deadline: Date.now(),
            }
      );
    });

    socket.on("candidate-rejoined", ({ message }: { message: string }) => {
      console.log("[Socket] candidate-rejoined:", message);
      setCandidateRecovery(null);
    });

    // General recovery / abandon
    socket.on("room-recovered", ({ message }: { message: string }) => {
      console.log("[Socket] room-recovered:", message);
      setCandidateRecovery(null);
      setHrRecovery(null);
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

    socket.on("transcript-saved", (result: { savedAt?: string; blockCount?: number }) => {
      const savedAt = formatIstDateTime(result.savedAt || new Date());
      setTranscriptSaveStatus(`Saved ${result.blockCount ?? 0} block(s) at ${savedAt}`);
    });

    socket.on("transcript-save-error", (message: string) => {
      setTranscriptSaveStatus(message || "Could not save transcript.");
    });

    return () => {
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
        setSocketInstance(null);
      }
    };
  }, [onAuthError, sessionToken]);

  const waitForJoinAck = useCallback((expectedRoomId?: string): Promise<{ roomId: string; role?: string; language?: RoomLanguage }> => {
    return new Promise((resolve, reject) => {
      if (socketRef.current) {
        const onJoinAck = (ack: { roomId: string; role?: string; language?: RoomLanguage }) => {
          if (expectedRoomId && ack.roomId !== expectedRoomId) return;
          socketRef.current?.off("join-ack", onJoinAck);
          socketRef.current?.off("join-error", onJoinError);
          resolve(ack);
        };

        const onJoinError = (msg: string) => {
          socketRef.current?.off("join-ack", onJoinAck);
          socketRef.current?.off("join-error", onJoinError);
          roomIdRef.current = null;
          userNameRef.current = null;
          reject(new Error(msg));
        };

        socketRef.current.on("join-ack", onJoinAck);
        socketRef.current.once("join-error", onJoinError);
      } else {
        reject(new Error("Socket not connected"));
      }
    });
  }, []);

  const joinRoom = useCallback(async (roomId: string, userName: string, role?: string): Promise<void> => {
    if (!socketRef.current) throw new Error("Socket not connected");

    roomIdRef.current = roomId;
    userNameRef.current = userName;
    if (role) {
      roleRef.current = role;
    }
    roomStateVersionRef.current = 0;

    const ackPromise = waitForJoinAck(roomId);
    socketRef.current.emit("join-room", { roomId, userName, role: roleRef.current });
    await ackPromise;
  }, [waitForJoinAck]);

  const createCandidateRoom = useCallback(async (userName: string, language: RoomLanguage): Promise<string> => {
    if (!socketRef.current) throw new Error("Socket not connected");

    userNameRef.current = userName;
    roleRef.current = "candidate";
    roomStateVersionRef.current = 0;

    const ackPromise = waitForJoinAck();
    socketRef.current.emit("candidate-create-room", { userName, language });
    const ack = await ackPromise;
    roomIdRef.current = ack.roomId;
    return ack.roomId;
  }, [waitForJoinAck]);

  const leaveRoom = useCallback(() => {
    if (socketRef.current) {
      roomIdRef.current = null;
      userNameRef.current = null;
      socketRef.current.emit("leave-room");
      setUsers([]);
      setBlocks([]);
      setActiveTranscriptionSession(null);
      setTranscriptSaveStatus(null);
      setIsTranscriptionChanging(false);
      setTranscriptionCountdown(null);
      setHrRecovery(null);
      setCandidateRecovery(null);
      roomStateVersionRef.current = 0;
    }
  }, []);

  const emitMuteToggle = useCallback((roomId: string, isMuted: boolean) => {
    if (socketRef.current) {
      // Align event with server listener "toggle-mute"
      socketRef.current.emit("toggle-mute", { roomId, isMuted });
    }
  }, []);

  const emitVideoToggle = useCallback((roomId: string, isVideoEnabled: boolean) => {
    if (socketRef.current) {
      socketRef.current.emit("toggle-video", { roomId, isVideoEnabled });
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
    socket: socketInstance,
    socketId,
    isConnected,
    users,
    blocks,
    roomState,
    activeTranscriptionSession,
    transcriptSaveStatus,
    isTranscriptionChanging,
    transcriptionCountdown,
    hrRecovery,
    candidateRecovery,
    joinRoom,
    createCandidateRoom,
    leaveRoom,
    emitMuteToggle,
    emitVideoToggle,
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
        setIsTranscriptionChanging(true);
        socketRef.current.emit("start-transcription", { roomId: roomIdRef.current });
      }
    }, []),
    emitStopTranscription: useCallback(() => {
      if (socketRef.current) {
        setIsTranscriptionChanging(true);
        socketRef.current.emit("stop-transcription", { roomId: roomIdRef.current });
      }
    }, []),
    emitSaveFinalTranscript: useCallback(() => {
      if (socketRef.current) {
        setTranscriptSaveStatus("Saving transcript...");
        socketRef.current.emit("save-final-transcript", { roomId: roomIdRef.current });
      }
    }, []),
  };
}
