class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Buffer size of 4096 samples (approx 256ms of audio at 16kHz sample rate)
    this.bufferSize = 4096;
    this.buffer = new Int16Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, _outputs, _parameters) {
    void _outputs;
    void _parameters;
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0]; // Mono microphone track

      if (channelData && channelData.length > 0) {
        // 1. Calculate the raw average amplitude (volume) of the audio frame
        let sum = 0;
        for (let i = 0; i < channelData.length; i++) {
          sum += Math.abs(channelData[i]);
        }
        const avg = sum / channelData.length;

        // Post the volume levels to the main thread
        this.port.postMessage({
          type: "volume",
          avg: avg
        });

        // 2. Accumulate PCM Float32 to Int16
        for (let i = 0; i < channelData.length; i++) {
          const s = Math.max(-1, Math.min(1, channelData[i]));
          const int16Val = s < 0 ? s * 0x8000 : s * 0x7fff;
          
          this.buffer[this.bufferIndex++] = int16Val;

          // When the buffer is full, emit the accumulated PCM block
          if (this.bufferIndex >= this.bufferSize) {
            const rawBuffer = this.buffer.buffer.slice(0);
            
            // Post the audio buffer using zero-copy transfer list
            this.port.postMessage({
              type: "audio",
              buffer: rawBuffer
            }, [rawBuffer]);
            
            // Reset index
            this.bufferIndex = 0;
          }
        }
      }
    }
    return true; // Keep processor alive
  }
}

registerProcessor("audio-processor", AudioProcessor);
