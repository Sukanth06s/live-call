class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Buffer size of 4096 samples (approx 256ms of audio at 16kHz sample rate)
    // This reduces WebSocket emission frequency from 125Hz to 4Hz (a 97% network overhead reduction!)
    this.bufferSize = 4096;
    this.buffer = new Int16Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0]; // Mono microphone track

      if (channelData && channelData.length > 0) {
        for (let i = 0; i < channelData.length; i++) {
          // Convert Float32 sample [-1.0, 1.0] to Int16 PCM sample [-32768, 32767]
          const s = Math.max(-1, Math.min(1, channelData[i]));
          const int16Val = s < 0 ? s * 0x8000 : s * 0x7fff;
          
          this.buffer[this.bufferIndex++] = int16Val;

          // When the buffer is full, emit the accumulated PCM block
          if (this.bufferIndex >= this.bufferSize) {
            // Slice the underlying ArrayBuffer to create a copy, leaving the worklet's array active
            const rawBuffer = this.buffer.buffer.slice(0);
            
            // Post the buffer to the main thread using high-performance zero-copy transfer list
            this.port.postMessage(rawBuffer, [rawBuffer]);
            
            // Reset index for the next block
            this.bufferIndex = 0;
          }
        }
      }
    }
    return true; // Keep processor alive
  }
}

registerProcessor("audio-processor", AudioProcessor);
