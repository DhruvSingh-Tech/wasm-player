/**
 * AudioWorklet Processor for streaming audio playback
 * Handles resampling from input sample rate to output sample rate
 */
class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = []; // Queue of { data: Float32Array[], sampleRate: number }
        this.currentChunk = null;
        this.readIndex = 0;
        this.isPlaying = false;
        this.resampleRatio = 1;
        this.fractionalIndex = 0;

        // Handle messages from main thread
        this.port.onmessage = (event) => {
            const { type, data, channels, sampleRate } = event.data;

            if (type === 'audio-data') {
                // data is an array of Float32Array (one per channel)
                this.buffer.push({
                    data: data,
                    channels: channels || 2,
                    sampleRate: sampleRate || 48000
                });
            } else if (type === 'play') {
                this.isPlaying = true;
            } else if (type === 'pause') {
                this.isPlaying = false;
            } else if (type === 'clear') {
                this.buffer = [];
                this.currentChunk = null;
                this.readIndex = 0;
                this.fractionalIndex = 0;
            }
        };
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        if (!output || output.length === 0) return true;

        const outputChannels = output.length;
        const frameCount = output[0].length; // Usually 128 frames
        const outputSampleRate = sampleRate; // Global sampleRate from AudioWorklet

        if (!this.isPlaying) {
            // Output silence
            for (let ch = 0; ch < outputChannels; ch++) {
                output[ch].fill(0);
            }
            return true;
        }

        let framesWritten = 0;

        while (framesWritten < frameCount) {
            // Get current chunk if needed
            if (!this.currentChunk && this.buffer.length > 0) {
                this.currentChunk = this.buffer.shift();
                this.readIndex = 0;
                this.fractionalIndex = 0;
                // Calculate resample ratio
                this.resampleRatio = this.currentChunk.sampleRate / outputSampleRate;
            }

            if (!this.currentChunk) {
                // Buffer underrun - output silence for remaining frames
                for (let ch = 0; ch < outputChannels; ch++) {
                    for (let i = framesWritten; i < frameCount; i++) {
                        output[ch][i] = 0;
                    }
                }
                break;
            }

            const chunk = this.currentChunk;
            const chunkChannels = chunk.data.length;
            const chunkFrames = chunk.data[0].length;

            // Resample and copy
            while (framesWritten < frameCount && this.readIndex < chunkFrames) {
                const srcIndex = Math.floor(this.fractionalIndex);

                if (srcIndex >= chunkFrames) {
                    break;
                }

                // Linear interpolation for resampling
                const nextIndex = Math.min(srcIndex + 1, chunkFrames - 1);
                const frac = this.fractionalIndex - srcIndex;

                for (let ch = 0; ch < outputChannels; ch++) {
                    const sourceChannel = ch < chunkChannels ? ch : 0;
                    const source = chunk.data[sourceChannel];
                    const sample1 = source[srcIndex] || 0;
                    const sample2 = source[nextIndex] || 0;
                    output[ch][framesWritten] = sample1 + (sample2 - sample1) * frac;
                }

                framesWritten++;
                this.fractionalIndex += this.resampleRatio;
                this.readIndex = Math.floor(this.fractionalIndex);
            }

            // If we've consumed the entire chunk, move to next
            if (this.readIndex >= chunkFrames) {
                this.currentChunk = null;
            }
        }

        return true; // Keep processor alive
    }
}

registerProcessor('audio-stream-processor', AudioStreamProcessor);
