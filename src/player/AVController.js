/**
 * AVController
 * 
 * Manages the synchronization between Audio and Video.
 * Uses a simple audio queue with ScriptProcessorNode for reliable playback.
 */
export class AVController {
    constructor(canvas, context, onTimeUpdate) {
        this.canvas = canvas;
        this.ctx = context;
        this.onTimeUpdate = onTimeUpdate;

        // State
        this.videoQueue = [];
        this.audioQueue = []; // Queue of { samples: Float32Array[], sampleRate: number }
        this.audioReadIndex = 0;
        this.currentAudioChunk = null;

        this.audioStartTime = 0;
        this.mediaStartTime = 0;
        this.isPlaying = false;

        this.audioContext = null;
        this.audioGain = null;
        this.scriptProcessor = null;
        this.outputSampleRate = 48000;

        // Config
        this.syncThreshold = 0.05;

        // Loop
        this.animationFrameId = null;
    }

    initAudio() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.outputSampleRate = this.audioContext.sampleRate;
            console.log('[AVController] AudioContext sampleRate:', this.outputSampleRate);

            this.audioGain = this.audioContext.createGain();
            this.audioGain.connect(this.audioContext.destination);

            // Use ScriptProcessorNode for reliable audio output
            // Buffer size 4096 gives us good latency without underruns
            this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 0, 2);
            this.scriptProcessor.onaudioprocess = this.processAudio.bind(this);
            this.scriptProcessor.connect(this.audioGain);

            console.log('[AVController] Audio initialized with ScriptProcessor');
        }
    }

    processAudio(event) {
        const outputL = event.outputBuffer.getChannelData(0);
        const outputR = event.outputBuffer.getChannelData(1);
        const bufferSize = outputL.length;

        if (!this.isPlaying) {
            outputL.fill(0);
            outputR.fill(0);
            return;
        }

        let written = 0;

        while (written < bufferSize) {
            // Get next chunk if needed
            if (!this.currentAudioChunk && this.audioQueue.length > 0) {
                this.currentAudioChunk = this.audioQueue.shift();
                this.audioReadIndex = 0;
            }

            if (!this.currentAudioChunk) {
                // Buffer underrun - fill with silence
                for (let i = written; i < bufferSize; i++) {
                    outputL[i] = 0;
                    outputR[i] = 0;
                }
                break;
            }

            const chunk = this.currentAudioChunk;
            const chunkSamples = chunk.samples[0].length;
            const inputSampleRate = chunk.sampleRate;

            // Calculate resampling ratio
            const ratio = inputSampleRate / this.outputSampleRate;

            // Resample and output
            while (written < bufferSize && this.audioReadIndex < chunkSamples) {
                const srcIdx = Math.floor(this.audioReadIndex);
                const nextIdx = Math.min(srcIdx + 1, chunkSamples - 1);
                const frac = this.audioReadIndex - srcIdx;

                // Linear interpolation
                const sampleL = chunk.samples[0][srcIdx] * (1 - frac) + chunk.samples[0][nextIdx] * frac;
                const sampleR = chunk.samples.length > 1
                    ? chunk.samples[1][srcIdx] * (1 - frac) + chunk.samples[1][nextIdx] * frac
                    : sampleL;

                outputL[written] = sampleL;
                outputR[written] = sampleR;
                written++;

                // Advance by the resampling ratio
                this.audioReadIndex += ratio;
            }

            // Check if we've consumed the chunk
            if (this.audioReadIndex >= chunkSamples) {
                this.currentAudioChunk = null;
                this.audioReadIndex = 0;
            }
        }
    }

    async play() {
        if (this.isPlaying) return;

        this.initAudio();
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        this.isPlaying = true;
        this.audioStartTime = this.audioContext.currentTime;

        // Don't clear audio queue - it should have audio from timestamp 0
        // Just reset the read position for any current chunk
        this.audioReadIndex = 0;

        this.renderLoop();
    }

    pause() {
        this.isPlaying = false;
        if (this.audioContext) {
            this.audioContext.suspend();
        }
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
    }

    enqueueVideoFrame(frame) {
        const pts = frame.timestamp / 1e6;
        this.videoQueue.push({ frame, pts });
    }

    enqueueAudioData(audioData) {
        // Queue audio even before play starts (same as video)
        // The ScriptProcessor will output silence when not playing

        try {
            const frameCount = audioData.numberOfFrames;
            const channels = audioData.numberOfChannels;
            const sampleRate = audioData.sampleRate;

            // Extract samples
            const samples = [];
            for (let i = 0; i < channels; i++) {
                const dest = new Float32Array(frameCount);
                audioData.copyTo(dest, { planeIndex: i, format: 'f32-planar' });
                samples.push(dest);
            }

            // Queue the audio chunk
            this.audioQueue.push({
                samples: samples,
                sampleRate: sampleRate
            });

        } catch (e) {
            console.error('[AVController] Audio enqueue error:', e);
        }

        audioData.close();
    }

    reset() {
        this.videoQueue.forEach(i => i.frame.close());
        this.videoQueue = [];
        this.audioQueue = [];
        this.currentAudioChunk = null;
        this.audioReadIndex = 0;
        this.mediaStartTime = 0;
    }

    renderLoop() {
        if (!this.isPlaying) return;

        this.processVideoQueue();

        const currentTime = this.getMasterTime();
        if (this.onTimeUpdate) this.onTimeUpdate(currentTime);

        this.animationFrameId = requestAnimationFrame(this.renderLoop.bind(this));
    }

    processVideoQueue() {
        if (this.videoQueue.length === 0) return;

        const now = this.getMasterTime();
        // console.log('[AVController] Time:', now, 'QueueLen:', this.videoQueue.length);

        while (this.videoQueue.length > 0) {
            const nextFrame = this.videoQueue[0];
            const diff = nextFrame.pts - now;

            if (diff < -this.syncThreshold) {
                // console.warn('[AVController] Dropping late frame. Diff:', diff);
                nextFrame.frame.close();
                this.videoQueue.shift();
                continue;
            }

            if (diff <= this.syncThreshold) {
                this.renderFrame(nextFrame.frame);
                nextFrame.frame.close();
                this.videoQueue.shift();
                continue;
            }

            break;
        }
    }

    renderFrame(frame) {
        if (!this.canvas) return;
        if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
            this.canvas.width = frame.displayWidth;
            this.canvas.height = frame.displayHeight;
        }
        this.ctx.drawImage(frame, 0, 0);
    }

    getMasterTime() {
        if (!this.audioContext) return 0;
        return (this.audioContext.currentTime - this.audioStartTime) + this.mediaStartTime;
    }

    seek(time) {
        this.mediaStartTime = time;
        this.audioStartTime = this.audioContext ? this.audioContext.currentTime : 0;
        this.audioQueue = [];
        this.currentAudioChunk = null;
        this.audioReadIndex = 0;
    }
}
