"use client";

import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useSocket } from "@/hooks/useSocket";
import { useAgora } from "@/hooks/useAgora";
import { useDeepgram } from "@/hooks/useDeepgram";

// Dynamic imports to avoid SSR issues with browser-only APIs
const Lobby = dynamic(() => import("@/components/Lobby"), { ssr: false });
const RoomPage = dynamic(() => import("@/components/RoomPage"), { ssr: false });

export default function Home() {
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
  } = useSocket();

  const {
    joinChannel,
    leaveChannel,
    toggleMute: agoraToggleMute,
    isMuted,
    isJoined: isAgoraJoined,
  } = useAgora();

  const roomIdRef = useRef("");

  const handleTranscript = useCallback(
    (text: string, isFinal: boolean) => {
      if (roomIdRef.current) {
        emitTranscript(roomIdRef.current, text, isFinal);
      }
    },
    [emitTranscript]
  );

  const {
    startTranscription,
    stopTranscription,
    isTranscribing,
  } = useDeepgram({ onTranscript: handleTranscript });

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
            const res = await fetch(`http://localhost:3001/api/token?channelName=${newRoomId}`);
            const data = await res.json();
            agoraToken = data.token;
          } catch (e) {
            console.error("Auto-token fetch failed, falling back to null:", e);
          }
        }

        // 3. Join Agora voice channel
        await joinChannel(newRoomId, agoraToken);

        // 3. Start Deepgram transcription
        await startTranscription();

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

    // Stop/start transcription based on mute state
    if (newMuted) {
      stopTranscription();
    } else {
      await startTranscription();
    }
  }, [agoraToggleMute, emitMuteToggle, roomId, stopTranscription, startTranscription]);

  if (!inRoom) {
    return <Lobby onJoinRoom={handleJoinRoom} isConnected={isConnected} />;
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
