"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { useSocket } from "@/hooks/useSocket";
import { useAgora } from "@/hooks/useAgora";
import { useDeepgram } from "@/hooks/useDeepgram";

import { supabase } from "@/lib/supabase";
import { Session } from "@supabase/supabase-js";

// Dynamic imports to avoid SSR issues with browser-only APIs
const Lobby = dynamic(() => import("@/components/Lobby"), { ssr: false });
const RoomPage = dynamic(() => import("@/components/RoomPage"), { ssr: false });

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoadingSession(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const [inRoom, setInRoom] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [userName, setUserName] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>(
    typeof window !== "undefined" ? sessionStorage.getItem("intendedRole") || "candidate" : "candidate"
  );

  const {
    socketId,
    isConnected,
    users,
    blocks,
    activeTranscriptionSession,
    joinRoom,
    leaveRoom: socketLeaveRoom,
    emitMuteToggle,
    emitTranscriptEdit,
    emitClearTranscript,
    emitTranscriptReplace,
    emitStartTranscription,
    emitStopTranscription,
    socket,
  } = useSocket(session?.access_token);

  const {
    joinChannel,
    leaveChannel,
    toggleMute: agoraToggleMute,
    getLocalTrack,
    getMediaStream,
    isMuted,
    isJoined: isAgoraJoined,
  } = useAgora();

  const roomIdRef = useRef("");

  const {
    startTranscription,
    stopTranscription,
  } = useDeepgram({ socket, roomId, userName });

  // 1. Permanent Transcription Lifecycle
  // This effect manages the absolute clean construction and teardown of the audio pipeline.
  // It is completely decoupled from mute states to ensure the AudioWorklet graph stays warm and active.
  useEffect(() => {
    if (inRoom) {
      const stream = getMediaStream();
      if (stream) {
        // Log Track State on Warm Startup
        const localAudioTrack = getLocalTrack();
        const mediaTrack = localAudioTrack?.getMediaStreamTrack();
        console.log("[TRACK STATE - LIFECYCLE START]", {
          id: mediaTrack?.id,
          readyState: mediaTrack?.readyState,
          muted: mediaTrack?.muted,
          enabled: mediaTrack?.enabled
        });

        startTranscription(stream);
      }
    } else {
      stopTranscription();
    }
  }, [inRoom, getMediaStream, startTranscription, stopTranscription, getLocalTrack]);

  useEffect(() => {
    if (!socket) return;
    
    const handleJoinError = async (message: string) => {
      console.error("[Socket] Join error received:", message);
      setJoinError(message);
      setInRoom(false);
      setRoomId("");
      setUserName("");
      roomIdRef.current = "";
      await leaveChannel();
      socketLeaveRoom();
    };

    const handleRoomClosed = async (message: string) => {
      console.warn("[Socket] Room closed received:", message);
      setJoinError(message);
      setInRoom(false);
      setRoomId("");
      setUserName("");
      roomIdRef.current = "";
      await leaveChannel();
      socketLeaveRoom();
    };

    socket.on("join-error", handleJoinError);
    socket.on("room-closed", handleRoomClosed);
    return () => {
      socket.off("join-error", handleJoinError);
      socket.off("room-closed", handleRoomClosed);
    };
  }, [socket, leaveChannel, socketLeaveRoom]);

  const handleJoinRoom = useCallback(
    async (newRoomId: string, newUserName: string, role: string, token?: string) => {
      try {
        setJoinError(null);
        setRoomId(newRoomId);
        setUserName(newUserName);
        roomIdRef.current = newRoomId;

        // Ensure session storage matches reality
        sessionStorage.setItem("intendedRole", role);
        setUserRole(role);

        joinRoom(newRoomId, newUserName, role);

        const tokenRole = role === "super_admin" ? "audience" : "broadcaster";

        let agoraToken = token;
        if (!agoraToken) {
          try {
            let socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";
            if (socketUrl && !socketUrl.startsWith("http://") && !socketUrl.startsWith("https://")) {
              socketUrl = `https://${socketUrl}`;
            }
            const res = await fetch(`${socketUrl}/api/token?channelName=${newRoomId}&role=${tokenRole}`);
            const data = await res.json();
            agoraToken = data.token;
          } catch (e) {
            console.error("Auto-token fetch failed:", e);
          }
        }

        // Just join Agora. The useEffect above will handle starting Deepgram.
        await joinChannel(newRoomId, agoraToken, undefined, role);
        setInRoom(true);
      } catch (err: any) {
        console.error("Failed to join room:", err);
        setJoinError(err.message || String(err));
        socketLeaveRoom();
        await leaveChannel();
        stopTranscription();
      }
    },
    [joinRoom, joinChannel, socketLeaveRoom, leaveChannel, stopTranscription]
  );

  const handleLeaveRoom = useCallback(async () => {
    try {
      stopTranscription(); // Final cleanup
      await leaveChannel();
      socketLeaveRoom();
      setInRoom(false);
      setRoomId("");
      setUserName("");
      roomIdRef.current = "";
    } catch (err) {
      console.error("Error leaving room:", err);
    }
  }, [stopTranscription, leaveChannel, socketLeaveRoom]);

  const handleToggleMute = useCallback(async () => {
    const newMuted = await agoraToggleMute();
    emitMuteToggle(roomId, newMuted);
    
    // Log Track State on Mute/Unmute toggle
    const localAudioTrack = getLocalTrack();
    const mediaTrack = localAudioTrack?.getMediaStreamTrack();
    console.log("[TRACK STATE - MUTE TOGGLE]", {
      id: mediaTrack?.id,
      readyState: mediaTrack?.readyState,
      muted: mediaTrack?.muted,
      enabled: mediaTrack?.enabled
    });
  }, [agoraToggleMute, emitMuteToggle, roomId, getLocalTrack]);

  useEffect(() => {
    // Legacy auto-join logic removed to enforce Lobby flow
  }, []);

  const handleEditBlock = useCallback((blockId: string, content: string) => {
    emitTranscriptEdit(roomId, blockId, content);
  }, [emitTranscriptEdit, roomId]);

  // Loading state
  if (loadingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#07070a]">
        <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  // Not authenticated state
  if (!session) {
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    return null;
  }

  if (!inRoom) {
    return (
      <>
        <div className="fixed top-4 right-4 z-50">
           <button 
             onClick={() => supabase.auth.signOut()}
             className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs hover:bg-white/10 transition-all"
           >
             Sign Out
           </button>
         </div>
        <Lobby 
          onJoinRoom={handleJoinRoom} 
          isConnected={isConnected} 
          defaultName={session.user?.email?.split('@')[0] || "User"} 
          joinError={joinError}
          onClearError={() => setJoinError(null)}
          accessToken={session?.access_token}
        />
      </>
    );
  }

  return (
    <RoomPage
      roomId={roomId}
      userName={userName}
      users={users}
      blocks={blocks}
      currentUserId={socketId}
      userRole={userRole}
      isMuted={isMuted}
      isConnected={isConnected}
      isAgoraJoined={isAgoraJoined}
      isTranscribing={activeTranscriptionSession?.isActive || false}
      onToggleMute={handleToggleMute}
      onLeaveRoom={handleLeaveRoom}
      onEditBlock={handleEditBlock}
      onClearTranscript={emitClearTranscript}
      onReplaceTranscript={emitTranscriptReplace}
      onStartTranscription={emitStartTranscription}
      onStopTranscription={emitStopTranscription}
    />
  );
}
