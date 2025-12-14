/**
 * AVController
 * 
 * Manages the synchronization between Audio and Video.
 * Acts as the 'Master Clock' using the AudioContext's time.
 */
export class AVController {
    constructor(canvas, context, onTimeUpdate) {
        this.canvas = canvas;
        this.ctx = context;
        this.onTimeUpdate = onTimeUpdate; // Callback for UI updates

        // State
        this.videoQueue = []; // Array of { frame: VideoFrame, pts: number }
        this.audioStartTime = 0; // The AudioContext time when playback started/resumed
        this.mediaStartTime = 0; // The Media (PTS) time when playback started/resumed
        this.isPlaying = false;

        this.audioContext = null;
        this.audioGain = null;
        this.nextAudioScheduleTime = 0;

        // Config
        this.syncThreshold = 0.05; // 50ms tolerance

        // Loop
        this.animationFrameId = null;
    }

    initAudio() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.audioGain = this.audioContext.createGain();
            this.audioGain.connect(this.audioContext.destination);
        }
    }

    play() {
        if (this.isPlaying) return;

        this.initAudio();
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.isPlaying = true;

        // Reset reference times
        // Master Clock = (AudioContext.currentTime - this.audioStartTime) + this.mediaStartTime
        this.audioStartTime = this.audioContext.currentTime;

        // If we are just starting, mediaStartTime is roughly where we left off
        // For accurate seek, this needs to be set by the seek handler

        this.nextAudioScheduleTime = Math.max(this.audioContext.currentTime, this.nextAudioScheduleTime);

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
        // Save current media time for resume? 
        // In a real app we'd track 'lastKnownTime'
    }

    /**
     * Called when WebCodecs outputs a video frame.
     */
    enqueueVideoFrame(frame) {
        // pts is in microseconds usually from WebCodecs, convert to seconds
        const pts = frame.timestamp / 1e6;
        // console.log('[AVController] VideoFrame enqueued. PTS:', pts);
        this.videoQueue.push({ frame, pts });
        // Sort? Usually WebCodecs outputs in order, but B-frames might complicate.
        // Assuming output is presentation order for now.
    }

    /**
     * Called when WebCodecs outputs audio data.
     */
    enqueueAudioData(audioData) {
        if (!this.audioContext) return;

        // Format conversion (simplified)
        // In prod: use AudioWorklet for glitch-free streaming. 
        // Here: Schedule BufferSource nodes.
        const frameCount = audioData.numberOfFrames;
        const channels = audioData.numberOfChannels;
        const sampleRate = audioData.sampleRate;

        const audioBuffer = this.audioContext.createBuffer(channels, frameCount, sampleRate);

        for (let i = 0; i < channels; i++) {
            // copyTo requires a destination buffer. 
            // Allocation per packet is expensive, reuse in prod.
            const dest = new Float32Array(frameCount);
            audioData.copyTo(dest, { planeIndex: 0, format: 'f32-planar' }); // Adjust for planar/interleaved
            audioBuffer.copyToChannel(dest, i);
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioGain);

        // Schedule
        let scheduleTime = this.nextAudioScheduleTime;
        if (scheduleTime < this.audioContext.currentTime) {
            scheduleTime = this.audioContext.currentTime;
        }

        source.start(scheduleTime);
        this.nextAudioScheduleTime = scheduleTime + audioBuffer.duration;

        audioData.close();
    }

    reset() {
        // Flush queues
        this.videoQueue.forEach(i => i.frame.close());
        this.videoQueue = [];
        this.nextAudioScheduleTime = 0;
        this.mediaStartTime = 0; // Reset or set to seek target
    }

    renderLoop() {
        if (!this.isPlaying) return;

        this.processVideoQueue();

        // Report time
        const currentTime = this.getMasterTime();
        if (this.onTimeUpdate) this.onTimeUpdate(currentTime);

        this.animationFrameId = requestAnimationFrame(this.renderLoop.bind(this));
    }

    processVideoQueue() {
        if (this.videoQueue.length === 0) return;

        const now = this.getMasterTime();
        console.log('[AVController] Time:', now, 'QueueLen:', this.videoQueue.length, 'NextPTS:', this.videoQueue[0] ? this.videoQueue[0].pts : 'N/A');

        // Drop late frames
        while (this.videoQueue.length > 0) {
            const nextFrame = this.videoQueue[0];
            const diff = nextFrame.pts - now;

            if (diff < -this.syncThreshold) {
                // Too late, drop
                console.warn('[AVController] Dropping late frame. Diff:', diff);
                nextFrame.frame.close();
                this.videoQueue.shift();
                continue;
            }

            if (diff <= this.syncThreshold) {
                // Time to render!
                // console.log('[AVController] Rendering frame. PTS:', nextFrame.pts);
                this.renderFrame(nextFrame.frame);
                nextFrame.frame.close(); // Important!
                this.videoQueue.shift();
                // Check next frame immediately in case we are behind multiple frames
                continue;
            }

            // Next frame is in the future
            break;
        }
    }

    renderFrame(frame) {
        if (!this.canvas) return;
        // Resize canvas if needed
        if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
            this.canvas.width = frame.displayWidth;
            this.canvas.height = frame.displayHeight;
        }
        this.ctx.drawImage(frame, 0, 0);
    }

    getMasterTime() {
        // Simple Audio Master Clock calculation
        if (!this.audioContext) return 0;
        // Correct logic:
        // When we play, we note audioStartTime (AC time).
        // Current VPTS = (AC.currentTime - audioStartTime) + mediaStartTime
        // Note: This drifts if audio underruns. Production requires checking AudioContext.outputLatency etc.
        return (this.audioContext.currentTime - this.audioStartTime) + this.mediaStartTime;
    }

    seek(time) {
        this.mediaStartTime = time;
        this.audioStartTime = this.audioContext ? this.audioContext.currentTime : 0;
        this.nextAudioScheduleTime = this.audioStartTime;
    }
}
