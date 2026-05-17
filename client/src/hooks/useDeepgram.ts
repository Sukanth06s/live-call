"use client";

import { useRef, useCallback, useState } from "react";

interface UseDeepgramOptions {
  socket: any;
  roomId: string;
}

export function useDeepgram({ socket, roomId }: UseDeepgramOptions) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletLoadedRef = useRef<boolean>(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const stopTranscription = useCallback(() => {
    if (sourceRef.current) {
      console.log("[Deepgram Proxy] Tearing down Source Node");
      try {
        sourceRef.current.disconnect();
      } catch (e) {
        console.warn("[Deepgram Proxy] Source disconnect warning:", e);
      }
      sourceRef.current = null;
    }
    if (workletNodeRef.current) {
      console.log("[Deepgram Proxy] Tearing down AudioWorklet Node");
      try {
        workletNodeRef.current.disconnect();
        workletNodeRef.current.port.onmessage = null;
      } catch (e) {
        console.warn("[Deepgram Proxy] AudioWorklet disconnect warning:", e);
      }
      workletNodeRef.current = null;
    }
    setIsTranscribing(false);
    console.log("[Deepgram Proxy] Transcription pipeline successfully dismantled.");
  }, []);

  const startTranscription = useCallback(async (externalStream: MediaStream) => {
    try {
      // 1. Verify stream and track validity
      const track = externalStream.getAudioTracks()[0];
      if (!track || track.readyState === "ended" || !externalStream.active) {
        console.warn("[Deepgram Proxy] Mic stream or track is inactive/ended. Skipping pipeline build.");
        return;
      }

      console.log(`[Deepgram Proxy] Starting pipeline. Track state - readyState: ${track.readyState}, enabled: ${track.enabled}, stream active: ${externalStream.active}`);

      // 2. Initialize the persistent AudioContext once
      if (!audioCtxRef.current) {
        console.log("[Deepgram Proxy] Creating persistent AudioContext");
        audioCtxRef.current = new AudioContext({ sampleRate: 16000 });
      }
      
      const audioContext = audioCtxRef.current;
      console.log(`[Deepgram Proxy] AudioContext initialized at sampleRate: ${audioContext.sampleRate}Hz`);

      // MOBILE FIX: Automatically resume AudioContext if suspended by the browser
      if (audioContext.state === "suspended") {
        console.log("[Deepgram Proxy] Resuming suspended AudioContext");
        await audioContext.resume();
      }

      // 3. Dismantle any old, stale connection graph to prevent memory leaks or frozen nodes
      if (sourceRef.current || workletNodeRef.current) {
        console.log("[Deepgram Proxy] Stale audio pipeline detected. Dismantling before rebuild...");
        stopTranscription();
      }

      // 4. Ensure AudioWorklet module is loaded (only once per context with cache-busting)
      if (!workletLoadedRef.current) {
        console.log("[Deepgram Proxy] Loading AudioWorklet module...");
        await audioContext.audioWorklet.addModule(`/audio-processor.js?v=${Date.now()}`);
        workletLoadedRef.current = true;
        console.log("[Deepgram Proxy] AudioWorklet module loaded successfully.");
      }

      // 5. FULL REBUILD: Create brand new AudioWorkletNode and MediaStreamAudioSourceNode
      console.log("[Deepgram Proxy] Rebuilding entire Audio Pipeline from scratch...");
      
      const workletNode = new AudioWorkletNode(audioContext, "audio-processor");
      let lastHeartbeat = Date.now();
      let chunkCount = 0;

      let lastVolumeLog = Date.now();

      // Listen to the worklet's port for messages
      workletNode.port.onmessage = (event) => {
        const message = event.data;

        if (message.type === "volume") {
          const now = Date.now();
          // Throttle volume logging to once per second to prevent mobile browser freezing
          if (now - lastVolumeLog > 1000) {
            console.log("[WORKLET VOLUME]", message.avg);
            lastVolumeLog = now;
          }
        } else if (message.type === "audio") {
          const pcmBuffer = message.buffer; // ArrayBuffer containing Int16 PCM data
          chunkCount++;

          const now = Date.now();
          if (now - lastHeartbeat > 5000) {
            console.log(`[Deepgram Proxy] AudioWorklet Heartbeat: Active, processed ${chunkCount} chunks, last buffer size: ${pcmBuffer.byteLength} bytes.`);
            lastHeartbeat = now;
          }

          if (socket && socket.connected) {
            console.log("[PCM SENT]", pcmBuffer.byteLength);
            socket.emit("audio-chunk", { 
              roomId, 
              audio: pcmBuffer,
              sampleRate: audioContext.sampleRate
            });
          }
        }
      };

      const source = audioContext.createMediaStreamSource(externalStream);

      // Wire new absolute thread-isolated graph
      source.connect(workletNode);
      workletNode.connect(audioContext.destination);

      // Store references
      sourceRef.current = source;
      workletNodeRef.current = workletNode;

      setIsTranscribing(true);
      console.log("[Deepgram Proxy] AudioWorklet graph active and processing audio frames in background!");

    } catch (err) {
      console.error("[Deepgram Proxy] Failed to start/rebuild AudioWorklet graph:", err);
    }
  }, [socket, roomId, stopTranscription]);

  return {
    startTranscription,
    stopTranscription,
    isTranscribing,
  };
}


