"use client";

import { useRef, useState, useCallback } from "react";
import type {
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
} from "agora-rtc-sdk-ng";

const APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID || "";

export function useAgora() {
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const localTrackRef = useRef<IMicrophoneAudioTrack | null>(null);
  const localCameraTrackRef = useRef<ICameraVideoTrack | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isJoined, setIsJoined] = useState(false);
  const [remoteUsers, setRemoteUsers] = useState<IAgoraRTCRemoteUser[]>([]);

  const joinChannel = useCallback(async (channelName: string, token?: string, uid?: number, role: string = "candidate") => {
    if (clientRef.current) return;
    
    console.log("[Agora] Attempting to join channel:");
    console.log(" - APP_ID:", APP_ID ? `${APP_ID.substring(0, 5)}...` : "EMPTY!");
    console.log(" - ChannelName:", channelName);
    console.log(" - UID:", uid);
    console.log(" - HasToken:", !!token);
    console.log(" - Role:", role);

    // Dynamic import to avoid SSR issues
    const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;

    const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    clientRef.current = client;

    // Handle remote users
    client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
      await client.subscribe(user, mediaType);
      if (mediaType === "audio") {
        user.audioTrack?.play();
      }
      if (mediaType === "video") {
        setRemoteUsers((prev) => {
          const existing = prev.find((u) => u.uid === user.uid);
          if (existing) {
            return prev.map((u) => (u.uid === user.uid ? user : u));
          }
          return [...prev, user];
        });
      }
      setRemoteUsers((prev) => {
        if (prev.find((u) => u.uid === user.uid)) return prev;
        return [...prev, user];
      });
    });

    client.on("user-unpublished", (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
      if (mediaType === "video") {
        setRemoteUsers((prev) => prev.filter((u) => u.uid !== user.uid));
      }
    });

    client.on("user-left", (user: IAgoraRTCRemoteUser) => {
      setRemoteUsers((prev) => prev.filter((u) => u.uid !== user.uid));
    });

    // Join channel (token optional)
    await client.join(APP_ID, channelName, token || null, uid ?? null);

    // Only create and publish local tracks if not super_admin
    if (role !== "super_admin") {
      const micTrack = await AgoraRTC.createMicrophoneAudioTrack({
        encoderConfig: "speech_standard",
      });
      localTrackRef.current = micTrack;
      await client.publish([micTrack]);

      try {
        const cameraTrack = await AgoraRTC.createCameraVideoTrack({
          encoderConfig: {
            width: 640,
            height: 360,
            frameRate: 15,
            bitrateMin: 400,
            bitrateMax: 800,
          },
        });
        localCameraTrackRef.current = cameraTrack;
        await client.publish([cameraTrack]);
        setIsVideoEnabled(true);
      } catch (err) {
        console.warn("[Agora] Camera unavailable. Continuing with microphone only:", err);
        localCameraTrackRef.current = null;
        setIsVideoEnabled(false);
      }

      setIsJoined(true);
      return micTrack;
    } else {
      setIsVideoEnabled(false);
      setIsJoined(true);
      return null;
    }
  }, []);

  const leaveChannel = useCallback(async () => {
    if (localCameraTrackRef.current) {
      localCameraTrackRef.current.stop();
      localCameraTrackRef.current.close();
      localCameraTrackRef.current = null;
    }
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
    setIsVideoEnabled(true);
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

  const getCameraTrack = useCallback(() => {
    return localCameraTrackRef.current;
  }, []);

  const getMediaStream = useCallback(() => {
    if (localTrackRef.current) {
      const track = localTrackRef.current.getMediaStreamTrack();
      return new MediaStream([track]);
    }
    return null;
  }, []);

  const toggleVideo = useCallback(async () => {
    if (localCameraTrackRef.current) {
      const newEnabled = !isVideoEnabled;
      await localCameraTrackRef.current.setEnabled(newEnabled);
      setIsVideoEnabled(newEnabled);
      return newEnabled;
    }
    return isVideoEnabled;
  }, [isVideoEnabled]);

  return {
    joinChannel,
    leaveChannel,
    toggleMute,
    toggleVideo,
    getLocalTrack,
    getCameraTrack,
    getMediaStream,
    isMuted,
    isVideoEnabled,
    isJoined,
    remoteUsers,
  };
}
