class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0]; // Mono channel

      if (channelData && channelData.length > 0) {
        // Convert Float32 samples [-1.0, 1.0] to Int16 PCM samples [-32768, 32767]
        const int16Data = new Int16Array(channelData.length);
        for (let i = 0; i < channelData.length; i++) {
          const s = Math.max(-1, Math.min(1, channelData[i]));
          int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Post the raw buffer to the main thread with zero-copy transfer list
        this.port.postMessage(int16Data.buffer, [int16Data.buffer]);
      }
    }
    return true; // Keep processor alive
  }
}

registerProcessor("audio-processor", AudioProcessor);
