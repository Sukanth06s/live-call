"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";
import { useAgora } from "@/hooks/useAgora";
import { useDeepgram } from "@/hooks/useDeepgram";

import { supabase } from "@/lib/supabase";
import { Session } from "@supabase/supabase-js";
import { CandidatePortfolioState, RoomLanguage, UserRole } from "@/types";

// Dynamic imports to avoid SSR issues with browser-only APIs
const Lobby = dynamic(() => import("@/components/Lobby"), { ssr: false });
const RoomPage = dynamic(() => import("@/components/RoomPage"), { ssr: false });
const CandidatePortfolio = dynamic(() => import("@/components/CandidatePortfolio"), { ssr: false });

function getSocketUrl() {
  let socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";
  if (socketUrl && !socketUrl.startsWith("http://") && !socketUrl.startsWith("https://")) {
    socketUrl = `https://${socketUrl}`;
  }
  return socketUrl;
}

function getJoinErrorMessage(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("permission_denied") ||
    normalized.includes("notallowederror") ||
    normalized.includes("permission denied")
  ) {
    return "Microphone access was blocked. Allow microphone permission for this site in your browser, then try joining again.";
  }

  if (normalized.includes("notfounderror") || normalized.includes("device not found")) {
    return "No microphone was found. Connect or enable a microphone, then try joining again.";
  }

  return message;
}

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [authorizedRole, setAuthorizedRole] = useState<UserRole>("candidate");
  const [profileLanguage, setProfileLanguage] = useState<RoomLanguage>("english");
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadedProfileToken, setLoadedProfileToken] = useState<string | null>(null);
  const [candidatePortfolio, setCandidatePortfolio] = useState<CandidatePortfolioState | null>(null);
  const [loadingCandidatePortfolio, setLoadingCandidatePortfolio] = useState(false);
  
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
  const [userRole, setUserRole] = useState<string>("candidate");
  const accessToken = session?.access_token;
  const sessionEmail = session?.user?.email;

  const handleInvalidSession = useCallback(
    async (message = "Your session has expired. Please sign in again.") => {
      sessionStorage.removeItem("intendedRole");
      sessionStorage.removeItem("intendedRoomId");
      sessionStorage.setItem("authNotice", message);
      setJoinError(message);
      setInRoom(false);
      setRoomId("");
      setUserName("");
      setSession(null);
      setLoadedProfileToken(null);
      await supabase.auth.signOut({ scope: "local" });
      router.replace("/login");
    },
    [router]
  );

  const {
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
    hrRecordingCandidate,
    joinRoom,
    createCandidateRoom,
    leaveRoom: socketLeaveRoom,
    emitMuteToggle,
    emitVideoToggle,
    emitTranscriptEdit,
    emitClearTranscript,
    emitTranscriptReplace,
    emitStartTranscription,
    emitStopTranscription,
    emitSaveFinalTranscript,
    socket,
  } = useSocket(accessToken, handleInvalidSession);

  const {
    joinChannel,
    leaveChannel,
    toggleMute: agoraToggleMute,
    toggleVideo: agoraToggleVideo,
    getCameraTrack,
    getMediaStream,
    isMuted,
    isVideoEnabled,
    isJoined: isAgoraJoined,
    remoteUsers,
  } = useAgora();

  const roomIdRef = useRef("");

  const loadCandidatePortfolio = useCallback(async () => {
    if (!accessToken || authorizedRole !== "candidate") {
      setCandidatePortfolio(null);
      return;
    }

    setLoadingCandidatePortfolio(true);
    try {
      const res = await fetch(`${getSocketUrl()}/api/candidate/portfolio`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (res.status === 401) {
        await handleInvalidSession("Your session has expired. Please sign in again.");
        return;
      }
      if (!res.ok) throw new Error("Unable to load candidate portfolio");
      const data = (await res.json()) as CandidatePortfolioState;
      setCandidatePortfolio(data);
    } catch (err) {
      console.warn("[CandidatePortfolio] Failed to load:", err);
      setCandidatePortfolio(null);
    } finally {
      setLoadingCandidatePortfolio(false);
    }
  }, [accessToken, authorizedRole, handleInvalidSession]);

  const {
    startTranscription,
    stopTranscription,
  } = useDeepgram({ socket, roomId, userName });

  useEffect(() => {
    if (!loadingSession && !session) {
      router.replace("/login");
    }
  }, [loadingSession, router, session]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    let isCancelled = false;
    const loadProfile = async () => {
      setLoadingProfile(true);
      setLoadedProfileToken(null);
      setAuthorizedRole("candidate");
      setUserRole("candidate");
      sessionStorage.setItem("intendedRole", "candidate");
      try {
        const res = await fetch(`${getSocketUrl()}/api/me`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (res.status === 401) {
          await handleInvalidSession("Your session has expired. Please sign in again.");
          return;
        }
        if (!res.ok) throw new Error("Unable to load account role");
        const data = await res.json();
        const role = data.user?.role || "candidate";
        const language = data.user?.language || "english";
        const displayName = data.user?.displayName || sessionEmail?.split('@')[0] || "User";
        const resolvedRole: UserRole =
          role === "hr" || role === "super_admin" || role === "candidate" ? role : "candidate";
        const resolvedLanguage: RoomLanguage =
          language === "tamil" || language === "hindi" || language === "english" ? language : "english";
        if (!isCancelled) {
          setAuthorizedRole(resolvedRole);
          setProfileLanguage(resolvedLanguage);
          setUserRole(resolvedRole);
          setUserName(displayName);
          if (resolvedRole !== "candidate") {
            setCandidatePortfolio(null);
          }
          sessionStorage.setItem("intendedRole", resolvedRole);
          setLoadedProfileToken(accessToken);
        }
      } catch (err) {
        console.error("[Auth] Failed to load account role:", err);
        if (!isCancelled) {
          setAuthorizedRole("candidate");
          setProfileLanguage("english");
          setUserRole("candidate");
          setLoadedProfileToken(accessToken);
          setJoinError("Could not verify your account role. You have been limited to Candidate access.");
        }
      } finally {
        if (!isCancelled) setLoadingProfile(false);
      }
    };

    void loadProfile();
    return () => {
      isCancelled = true;
    };
  }, [accessToken, handleInvalidSession, sessionEmail]);

  useEffect(() => {
    if (!accessToken || inRoom || loadingProfile || loadedProfileToken !== accessToken) return;
    if (authorizedRole !== "candidate") return;

    const timeout = window.setTimeout(() => {
      void loadCandidatePortfolio();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [accessToken, authorizedRole, inRoom, loadedProfileToken, loadingProfile, loadCandidatePortfolio]);

  // 1. Candidate-only Transcription Lifecycle
  // Only the candidate streams PCM to Deepgram; HR and Super Admin stay on Agora audio/video only.
  useEffect(() => {
    if (inRoom && userRole === "candidate" && activeTranscriptionSession?.isActive) {
      const stream = getMediaStream();
      if (stream) {
        startTranscription(stream);
      }
    } else {
      stopTranscription();
    }
  }, [inRoom, userRole, activeTranscriptionSession?.isActive, getMediaStream, startTranscription, stopTranscription]);

  useEffect(() => {
    if (!socket) return;
    
    const handleJoinError = async (message: string) => {
      console.warn("[Socket] Join error received:", message);
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

    const handleForceLogout = async (message: string) => {
      console.warn("[Socket] Force logout received:", message);
      sessionStorage.removeItem("intendedRole");
      sessionStorage.setItem("authNotice", message);
      setJoinError(message);
      setInRoom(false);
      setRoomId("");
      setUserName("");
      roomIdRef.current = "";
      await leaveChannel();
      await supabase.auth.signOut({ scope: "local" });
      router.replace("/login");
    };

    socket.on("join-error", handleJoinError);
    socket.on("room-closed", handleRoomClosed);
    socket.on("force-logout", handleForceLogout);
    return () => {
      socket.off("join-error", handleJoinError);
      socket.off("room-closed", handleRoomClosed);
      socket.off("force-logout", handleForceLogout);
    };
  }, [router, socket, leaveChannel, socketLeaveRoom]);

  const handleJoinRoom = useCallback(
    async (newRoomId: string, newUserName: string, _role: string, token?: string, language?: RoomLanguage) => {
      try {
        setJoinError(null);
        setUserName(newUserName);

        const resolvedRole = authorizedRole;
        sessionStorage.setItem("intendedRole", resolvedRole);
        setUserRole(resolvedRole);

        const resolvedRoomId =
          resolvedRole === "candidate"
            ? newRoomId || (await createCandidateRoom(newUserName, language || "english"))
            : newRoomId;

        setRoomId(resolvedRoomId);
        roomIdRef.current = resolvedRoomId;

        if (resolvedRole !== "candidate" || newRoomId) {
          await joinRoom(resolvedRoomId, newUserName, resolvedRole);
        }

        let agoraToken = token;
        let agoraUid: number | undefined;
        if (!agoraToken) {
          try {
            const params = new URLSearchParams({
              channelName: resolvedRoomId,
            });
            const res = await fetch(`${getSocketUrl()}/api/token?${params.toString()}`, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            });
            if (!res.ok) {
              const errorText = await res.text();
              throw new Error(`Agora token request failed (${res.status}): ${errorText}`);
            }
            const data = await res.json();
            if (!data.token || data.uid === undefined || data.uid === null) {
              throw new Error("Agora token response did not include token and uid");
            }
            agoraToken = data.token;
            agoraUid = typeof data.uid === "number" ? data.uid : Number(data.uid);
            if (!Number.isFinite(agoraUid)) {
              throw new Error("Agora token response included an invalid uid");
            }
          } catch (e) {
            console.error("Auto-token fetch failed:", e);
            throw e;
          }
        }

        // Just join Agora. The useEffect above will handle starting Deepgram.
        await joinChannel(resolvedRoomId, agoraToken, agoraUid, resolvedRole);
        setInRoom(true);
      } catch (err: unknown) {
        console.warn("Failed to join room:", err);
        setJoinError(getJoinErrorMessage(err));
        socketLeaveRoom();
        await leaveChannel();
        stopTranscription();
      }
    },
    [accessToken, authorizedRole, createCandidateRoom, joinRoom, joinChannel, socketLeaveRoom, leaveChannel, stopTranscription]
  );

  useEffect(() => {
    if (!accessToken || inRoom || loadedProfileToken !== accessToken || authorizedRole !== "super_admin") return;
    const intendedRoomId = sessionStorage.getItem("intendedRoomId");
    if (!intendedRoomId) return;

    sessionStorage.removeItem("intendedRoomId");
    const timeout = window.setTimeout(() => {
      void handleJoinRoom(intendedRoomId, userName || sessionEmail?.split("@")[0] || "User", "super_admin");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [accessToken, authorizedRole, handleJoinRoom, inRoom, loadedProfileToken, sessionEmail, userName]);

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
  }, [agoraToggleMute, emitMuteToggle, roomId]);

  const handleToggleVideo = useCallback(async () => {
    const newVideoEnabled = await agoraToggleVideo();
    emitVideoToggle(roomId, newVideoEnabled);
  }, [agoraToggleVideo, emitVideoToggle, roomId]);

  useEffect(() => {
    // Legacy auto-join logic removed to enforce Lobby flow
  }, []);

  const handleEditBlock = useCallback((blockId: string, content: string) => {
    emitTranscriptEdit(roomId, blockId, content);
  }, [emitTranscriptEdit, roomId]);

  // Loading state
  if (loadingSession || (session && (loadingProfile || loadedProfileToken !== accessToken))) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#07070a]">
        <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  // Not authenticated state
  if (!session) {
    return null;
  }

  if (!inRoom && authorizedRole === "candidate" && loadingCandidatePortfolio) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#07070a]">
        <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!inRoom && authorizedRole === "candidate" && candidatePortfolio?.portfolioReady) {
    return (
      <CandidatePortfolio
        portfolio={candidatePortfolio}
        candidateName={userName || sessionEmail?.split("@")[0] || "Candidate"}
        onSignOut={() => {
          sessionStorage.removeItem("intendedRole");
          void supabase.auth.signOut();
        }}
      />
    );
  }

  if (!inRoom) {
    return (
      <>
        <div className="fixed top-4 right-4 z-50">
           <button 
             onClick={() => {
               sessionStorage.removeItem("intendedRole");
               void supabase.auth.signOut();
             }}
             className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs hover:bg-white/10 transition-all"
           >
             Sign Out
           </button>
         </div>
        <Lobby 
          onJoinRoom={handleJoinRoom} 
          isConnected={isConnected} 
          authorizedRole={authorizedRole}
          userLanguage={profileLanguage}
          defaultName={userName || sessionEmail?.split('@')[0] || "User"} 
          joinError={joinError}
          onClearError={() => setJoinError(null)}
          accessToken={accessToken}
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
      localCameraTrack={getCameraTrack()}
      remoteUsers={remoteUsers}
      accessToken={accessToken}
      socket={socket}
      roomState={roomState}
      isMuted={isMuted}
      isVideoEnabled={isVideoEnabled}
      isConnected={isConnected}
      isAgoraJoined={isAgoraJoined}
      isTranscribing={activeTranscriptionSession?.isActive || false}
      isTranscriptionChanging={isTranscriptionChanging}
      transcriptionCountdown={transcriptionCountdown}
      hrRecovery={hrRecovery}
      candidateRecovery={candidateRecovery}
      hrRecordingCandidate={hrRecordingCandidate}
      onToggleMute={handleToggleMute}
      onToggleVideo={handleToggleVideo}
      onLeaveRoom={handleLeaveRoom}
      onEditBlock={handleEditBlock}
      onClearTranscript={emitClearTranscript}
      onReplaceTranscript={emitTranscriptReplace}
      onStartTranscription={emitStartTranscription}
      onStopTranscription={emitStopTranscription}
      onSaveFinalTranscript={emitSaveFinalTranscript}
      transcriptSaveStatus={transcriptSaveStatus}
    />
  );
}
