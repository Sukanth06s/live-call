"use client";

import { useRef, useCallback, useState } from "react";

const DEEPGRAM_API_KEY = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY || "";

interface UseDeepgramOptions {
  onTranscript: (text: string, isFinal: boolean) => void;
}

export function useDeepgram({ onTranscript }: UseDeepgramOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const startTranscription = useCallback(async () => {
    if (wsRef.current || isTranscribing) return;
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

      // Connect to Deepgram WebSocket
      const ws = new WebSocket(
        `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&punctuate=true&interim_results=true&endpointing=300`,
        ["token", DEEPGRAM_API_KEY]
      );

      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[Deepgram] WebSocket connected");
        setIsTranscribing(true);

        // Use AudioContext + ScriptProcessor/AudioWorklet to send raw PCM
        const audioContext = new AudioContext({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);

        source.connect(processor);
        processor.connect(audioContext.destination);

        processor.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN) {
            const inputData = e.inputBuffer.getChannelData(0);
            // Convert float32 to int16
            const int16Data = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              const s = Math.max(-1, Math.min(1, inputData[i]));
              int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            ws.send(int16Data.buffer);
          }
        };

        // Store for cleanup
        (ws as any)._audioContext = audioContext;
        (ws as any)._processor = processor;
        (ws as any)._source = source;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.channel?.alternatives?.[0]) {
            const transcript = data.channel.alternatives[0].transcript;
            const isFinal = data.is_final;
            if (transcript && transcript.trim()) {
              onTranscript(transcript, isFinal);
            }
          }
        } catch (err) {
          console.error("[Deepgram] Parse error:", err);
        }
      };

      ws.onerror = (error) => {
        console.error("[Deepgram] WebSocket error:", error);
      };

      ws.onclose = () => {
        console.log("[Deepgram] WebSocket closed");
        setIsTranscribing(false);
        // Cleanup audio nodes
        if ((ws as any)._processor) {
          (ws as any)._processor.disconnect();
        }
        if ((ws as any)._source) {
          (ws as any)._source.disconnect();
        }
        if ((ws as any)._audioContext) {
          (ws as any)._audioContext.close();
        }
      };
    } catch (err) {
      console.error("[Deepgram] Failed to start transcription:", err);
    }
  }, [onTranscript]);

  const stopTranscription = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsTranscribing(false);
  }, []);

  return {
    startTranscription,
    stopTranscription,
    isTranscribing,
  };
}
