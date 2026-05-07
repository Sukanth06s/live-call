"use client";

import { useRef, useCallback, useState } from "react";

interface UseDeepgramOptions {
  socket: any;
  roomId: string;
}

interface UseDeepgramOptions {
  socket: any;
  roomId: string;
}

export function useDeepgram({ socket, roomId }: UseDeepgramOptions) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const startTranscription = useCallback(async (externalStream: MediaStream) => {
    try {
      // 1. Initialize AudioContext and Processor only ONCE
      if (!audioCtxRef.current) {
        console.log("[Deepgram Proxy] Creating persistent AudioContext");
        audioCtxRef.current = new AudioContext({ sampleRate: 16000 });
      }
      
      const audioContext = audioCtxRef.current;

      if (!processorRef.current) {
        console.log("[Deepgram Proxy] Creating persistent Processor");
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
        processorRef.current = processor;
        processor.connect(audioContext.destination);
      }

      // 2. Hot-Swap the Source
      if (sourceRef.current) {
        console.log("[Deepgram Proxy] Unplugging old source track");
        sourceRef.current.disconnect();
      }

      console.log("[Deepgram Proxy] Plugging in new source track");
      const source = audioContext.createMediaStreamSource(externalStream);
      sourceRef.current = source;
      source.connect(processorRef.current);

      setIsTranscribing(true);

    } catch (err) {
      console.error("[Deepgram Proxy] Failed to start/swap:", err);
    }
  }, [socket, roomId]);

  const stopTranscription = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    // Note: We keep the processor and context alive for possible unmuting
    setIsTranscribing(false);
    console.log("[Deepgram Proxy] Transcription paused (Source unplugged)");
  }, []);

  return {
    startTranscription,
    stopTranscription,
    isTranscribing,
  };
}
