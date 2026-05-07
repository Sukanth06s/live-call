"use client";

import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useSocket } from "@/hooks/useSocket";
import { useAgora } from "@/hooks/useAgora";
import { useDeepgram } from "@/hooks/useDeepgram";

import { useSession, signIn, signOut } from "next-auth/react";

// Dynamic imports to avoid SSR issues with browser-only APIs
const Lobby = dynamic(() => import("@/components/Lobby"), { ssr: false });
const RoomPage = dynamic(() => import("@/components/RoomPage"), { ssr: false });

export default function Home() {
  const { data: session, status } = useSession();
  const [inRoom, setInRoom] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [userName, setUserName] = useState("");

  const {
    socketId,
    isConnected,
    users,
    transcripts,
    joinRoom,
    leaveRoom: socketLeaveRoom,
    emitTranscript,
    emitMuteToggle,
    socket, // We need the raw socket now
  } = useSocket();

  const {
    joinChannel,
    leaveChannel,
    toggleMute: agoraToggleMute,
    getMediaStream,
    isMuted,
    isJoined: isAgoraJoined,
  } = useAgora();

  const roomIdRef = useRef("");

  const {
    startTranscription,
    stopTranscription,
    isTranscribing,
  } = useDeepgram({ socket, roomId });

  const handleJoinRoom = useCallback(
    async (newRoomId: string, newUserName: string, token?: string) => {
      try {
        setRoomId(newRoomId);
        setUserName(newUserName);
        roomIdRef.current = newRoomId;

        // 1. Join socket room
        joinRoom(newRoomId, newUserName);

        // 2. Fetch Agora token if not provided manually
        let agoraToken = token;
        if (!agoraToken) {
          try {
            // Updated to use the REMOTE Railway backend
            const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";
            const res = await fetch(`${socketUrl}/api/token?channelName=${newRoomId}`);
            const data = await res.json();
            agoraToken = data.token;
          } catch (e) {
            console.error("Auto-token fetch failed, falling back to null:", e);
          }
        }

        // 3. Join Agora voice channel
        const track = await joinChannel(newRoomId, agoraToken);

        // 4. Start Deepgram transcription using the Agora track
        const stream = getMediaStream();
        if (stream) {
          await startTranscription(stream);
        }

        setInRoom(true);
      } catch (err) {
        console.error("Failed to join room:", err);
        // Cleanup on failure
        socketLeaveRoom();
        await leaveChannel();
        stopTranscription();
      }
    },
    [joinRoom, joinChannel, startTranscription, socketLeaveRoom, leaveChannel, stopTranscription]
  );

  const handleLeaveRoom = useCallback(async () => {
    try {
      stopTranscription();
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
    
    if (newMuted) {
      stopTranscription();
    } else {
      const stream = getMediaStream();
      if (stream) {
        await startTranscription(stream);
      }
    }
  }, [agoraToggleMute, emitMuteToggle, roomId, stopTranscription, startTranscription, getMediaStream]);

  // Loading state
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#07070a]">
        <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  // Not authenticated state
  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#07070a] px-4">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[150px] pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[150px] pointer-events-none" />
        
        <div className="relative z-10 text-center space-y-6 max-w-md">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-3xl flex items-center justify-center mx-auto shadow-2xl shadow-blue-500/20">
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-white tracking-tight">LiveRoom</h1>
          <p className="text-gray-400 text-lg">Secure real-time voice and AI transcription. Sign in to start chatting.</p>
          <button
            onClick={() => signIn("credentials", { username: `User_${Math.floor(Math.random() * 1000)}`, callbackUrl: "/" })}
            className="w-full py-4 bg-white text-black font-bold rounded-2xl hover:bg-gray-200 transition-all shadow-xl active:scale-[0.98]"
          >
            Get Started
          </button>
        </div>
      </div>
    );
  }

  if (!inRoom) {
    return (
      <>
        <div className="fixed top-4 right-4 z-50">
           <button 
             onClick={() => signOut()}
             className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs hover:bg-white/10 transition-all"
           >
             Sign Out
           </button>
        </div>
        <Lobby onJoinRoom={handleJoinRoom} isConnected={isConnected} defaultName={session.user?.name || ""} />
      </>
    );
  }

  return (
    <RoomPage
      roomId={roomId}
      userName={userName}
      users={users}
      transcripts={transcripts}
      currentUserId={socketId}
      isMuted={isMuted}
      isConnected={isConnected}
      isAgoraJoined={isAgoraJoined}
      isTranscribing={isTranscribing}
      onToggleMute={handleToggleMute}
      onLeaveRoom={handleLeaveRoom}
    />
  );
}
