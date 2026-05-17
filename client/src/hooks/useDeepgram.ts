"use client";

import { useRef, useCallback, useState } from "react";

interface UseDeepgramOptions {
  socket: any;
  roomId: string;
}

export function useDeepgram({ socket, roomId }: UseDeepgramOptions) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
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
    if (processorRef.current) {
      console.log("[Deepgram Proxy] Tearing down Processor Node");
      try {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
      } catch (e) {
        console.warn("[Deepgram Proxy] Processor disconnect warning:", e);
      }
      processorRef.current = null;
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

      // 2. Initialize the persistent AudioContext once
      if (!audioCtxRef.current) {
        console.log("[Deepgram Proxy] Creating persistent AudioContext");
        audioCtxRef.current = new AudioContext({ sampleRate: 16000 });
      }
      
      const audioContext = audioCtxRef.current;

      // MOBILE FIX: Automatically resume AudioContext if suspended by the browser
      if (audioContext.state === "suspended") {
        console.log("[Deepgram Proxy] Resuming suspended AudioContext");
        await audioContext.resume();
      }

      // 3. Dismantle any old, stale connection graph to prevent memory leaks or frozen nodes
      if (sourceRef.current || processorRef.current) {
        console.log("[Deepgram Proxy] Stale audio pipeline detected. Dismantling before rebuild...");
        stopTranscription();
      }

      // 4. FULL REBUILD: Create brand new nodes to restart browser's audio processing thread
      console.log("[Deepgram Proxy] Rebuilding entire Audio Pipeline from scratch...");
      
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        if (socket && socket.connected) {
          const inputData = e.inputBuffer.getChannelData(0);
          const int16Data = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          socket.emit("audio-chunk", { roomId, audio: int16Data.buffer });
        }
      };

      const source = audioContext.createMediaStreamSource(externalStream);

      // Wire new absolute graph
      source.connect(processor);
      processor.connect(audioContext.destination);

      // Store references
      sourceRef.current = source;
      processorRef.current = processor;

      setIsTranscribing(true);
      console.log("[Deepgram Proxy] Web Audio graph built and processing frames!");

    } catch (err) {
      console.error("[Deepgram Proxy] Failed to start/rebuild transcription graph:", err);
    }
  }, [socket, roomId, stopTranscription]);

  return {
    startTranscription,
    stopTranscription,
    isTranscribing,
  };
}

