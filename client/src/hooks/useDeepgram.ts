"use client";

import { useRef, useCallback, useState } from "react";

interface UseDeepgramOptions {
  socket: any;
  roomId: string;
}

export function useDeepgram({ socket, roomId }: UseDeepgramOptions) {
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const startTranscription = useCallback(async () => {
    if (isTranscribing) return;
    try {
      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(audioContext.destination);

      processor.onaudioprocess = (e) => {
        if (socket && socket.connected) {
          const inputData = e.inputBuffer.getChannelData(0);
          // Convert float32 to int16
          const int16Data = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          // Send raw audio chunk to backend proxy
          socket.emit("audio-chunk", { roomId, audio: int16Data.buffer });
        }
      };

      setIsTranscribing(true);
      console.log("[Deepgram Proxy] Audio streaming started");

    } catch (err) {
      console.error("[Deepgram Proxy] Failed to start:", err);
    }
  }, [isTranscribing, socket, roomId]);

  const stopTranscription = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsTranscribing(false);
    console.log("[Deepgram Proxy] Audio streaming stopped");
  }, []);

  return {
    startTranscription,
    stopTranscription,
    isTranscribing,
  };
}
