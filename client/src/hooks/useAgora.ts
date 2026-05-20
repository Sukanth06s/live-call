"use client";

import { useRef, useState, useCallback } from "react";

// Agora types - imported dynamically to avoid SSR window error
type IAgoraRTCClient = any;
type IMicrophoneAudioTrack = any;
type IAgoraRTCRemoteUser = any;

const APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID || "";

export function useAgora() {
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const localTrackRef = useRef<IMicrophoneAudioTrack | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [remoteUsers, setRemoteUsers] = useState<IAgoraRTCRemoteUser[]>([]);

  const joinChannel = useCallback(async (channelName: string, token?: string, uid?: string, role: string = "candidate") => {
    if (clientRef.current) return;
    
    console.log("[Agora] Attempting to join channel:");
    console.log(" - APP_ID:", APP_ID ? `${APP_ID.substring(0, 5)}...` : "EMPTY!");
    console.log(" - ChannelName:", channelName);
    console.log(" - HasToken:", !!token);
    console.log(" - Role:", role);

    // Dynamic import to avoid SSR issues
    const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;

    const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    clientRef.current = client;

    // Handle remote users
    client.on("user-published", async (user: any, mediaType: "audio" | "video") => {
      await client.subscribe(user, mediaType);
      if (mediaType === "audio") {
        user.audioTrack?.play();
      }
      setRemoteUsers((prev: any[]) => {
        if (prev.find((u: any) => u.uid === user.uid)) return prev;
        return [...prev, user];
      });
    });

    client.on("user-unpublished", (user: any) => {
      setRemoteUsers((prev: any[]) => prev.filter((u: any) => u.uid !== user.uid));
    });

    client.on("user-left", (user: any) => {
      setRemoteUsers((prev: any[]) => prev.filter((u: any) => u.uid !== user.uid));
    });

    // Join channel (token optional)
    await client.join(APP_ID, channelName, token || null, uid || null);

    // Only create and publish mic track if not super_admin
    if (role !== "super_admin") {
      const micTrack = await AgoraRTC.createMicrophoneAudioTrack({
        encoderConfig: "speech_standard",
      });
      localTrackRef.current = micTrack;
      await client.publish([micTrack]);
      setIsJoined(true);
      return micTrack;
    } else {
      setIsJoined(true);
      return null;
    }
  }, []);

  const leaveChannel = useCallback(async () => {
    if (localTrackRef.current) {
      localTrackRef.current.stop();
      localTrackRef.current.close();
      localTrackRef.current = null;
    }
    if (clientRef.current) {
      await clientRef.current.leave();
      clientRef.current = null;
    }
    setIsJoined(false);
    setRemoteUsers([]);
    setIsMuted(false);
  }, []);

  const toggleMute = useCallback(async () => {
    if (localTrackRef.current) {
      const newMuted = !isMuted;
      // Using setMuted (Soft Mute) instead of setEnabled (Hard Mute)
      // This keeps the microphone hardware active and stable.
      await localTrackRef.current.setMuted(newMuted);
      setIsMuted(newMuted);
      return newMuted;
    }
    return isMuted;
  }, [isMuted]);

  const getLocalTrack = useCallback(() => {
    return localTrackRef.current;
  }, []);

  const getMediaStream = useCallback(() => {
    if (localTrackRef.current) {
      const track = localTrackRef.current.getMediaStreamTrack();
      return new MediaStream([track]);
    }
    return null;
  }, []);

  return {
    joinChannel,
    leaveChannel,
    toggleMute,
    getLocalTrack,
    getMediaStream,
    isMuted,
    isJoined,
    remoteUsers,
  };
}
