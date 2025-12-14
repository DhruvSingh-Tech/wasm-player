import videojs from 'video.js';
import { AVController } from '../player/AVController.js';

const Tech = videojs.getComponent('Tech');

/**
 * Custom Video.js Tech for playing MKV files using WebAssembly (WASM) and WebCodecs.
 */
export class MkvWasmTech extends Tech {
    constructor(options, ready) {
        super(options, ready);

        this.worker = null;
        this.audioDecoder = null;
        this.videoDecoder = null;
        this.videoCanvas = null;
        this.ctx = null;
        this.audioContext = null;
        this.audioGain = null;
        this.audioNextTime = 0;

        this.currentLoop = null;
        this.isSeeking = false;
        this.internalPaused = true;

        this.bufferState = { video: [], audio: [] };

        console.log('[MkvWasmTech] Constructor called');

        this.timebase = { video: 0, audio: 0 };

        // Initialize
        this.initializeUI();
        this.avController = new AVController(this.videoCanvas, this.ctx, (time) => {
            // Update Video.js time
            // We shouldn't trigger 'timeupdate' here excessively, Video.js does its own polling usually,
            // but for custom tech, we can push updates.
            this.trigger('timeupdate');
        });

        this.initializeWorker();

        // Check if source is provided in options (common in Video.js initialization)
        if (options.source) {
            this.setSrc(options.source.src);
        }

        this.on('dispose', () => {
            this.cleanup();
        });
    }

    initializeUI() {
        this.videoCanvas = document.createElement('canvas');
        this.videoCanvas.className = 'vjs-tech';
        this.el_.appendChild(this.videoCanvas);
        this.ctx = this.videoCanvas.getContext('2d');
    }

    initializeWorker() {
        if (this.worker) return; // Don't recreate if exists
        console.log('[MkvWasmTech] Initializing Worker');
        this.worker = new Worker(new URL('../worker/demuxer.worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = this.handleWorkerMessage.bind(this);
        this.worker.postMessage({ cmd: 'init' });
    }

    createEl() {
        const el = videojs.dom.createEl('div', {
            className: 'vjs-tech'
        });
        return el;
    }

    setSrc(src) {
        // this.cleanup(); // Don't kill worker here, just stop fetching
        // this.initializeWorker(); 
        console.log('[MkvWasmTech] Loading:', src);
        if (!this.worker) this.initializeWorker();

        // Send fetch command
        this.worker.postMessage({ cmd: 'fetch', url: src });
        // Assume loading state
        this.trigger('waiting');
    }

    play() {
        if (this.internalPaused) {
            this.internalPaused = false;
            this.avController.play();
            this.trigger('play');
        }
    }

    pause() {
        this.internalPaused = true;
        this.avController.pause();
        this.trigger('pause');
    }

    setCurrentTime(seconds) {
        if (this.avController) {
            this.avController.seek(seconds);
        }
        if (this.worker) {
            this.worker.postMessage({ cmd: 'seek', time: seconds });
        }
        this.trigger('seeking');
    }

    currentTime() {
        if (this.avController) {
            return this.avController.getMasterTime();
        }
        return 0;
    }

    duration() {
        return this.duration_ || 0;
    }

    // Standard Tech Methods expected by Video.js
    playbackRate(rate) {
        if (rate === undefined) return 1;
        // Todo: Implement rate control in AVController
        return 1;
    }

    muted(muted) {
        if (muted === undefined) return false;
        // Todo: Implement mute in AVController/AudioContext
        return false;
    }

    volume(vol) {
        if (vol === undefined) return 1;
        // Todo: Implement volume in AVController/GainNode
        return 1;
    }

    paused() {
        return this.internalPaused;
    }

    ended() {
        // Todo: track if duration reached
        return false;
    }

    error() {
        return null;
    }

    handleWorkerMessage(e) {
        const msg = e.data;
        switch (msg.type) {
            case 'metadata':
                this.handleMetadata(msg.data);
                break;
            case 'packet':
                this.queuePacket(msg);
                break;
            case 'error':
                this.trigger('error', msg.error);
                break;
        }
    }

    handleMetadata(metadata) {
        // metadata: { duration, videoTrack, audioTracks }
        this.duration_ = metadata.duration;
        this.trigger('durationchange');

        // Configure Decoders
        if (metadata.videoTrack) {
            this.videoTrackId = metadata.videoTrack.trackId;
            this.setupVideoDecoder(metadata.videoTrack);
        }
        // Setup Audio always if possible
        if (metadata.audioTracks && metadata.audioTracks.length > 0) {
            this.setupAudioDecoder(metadata.audioTracks[0]);
        } else {
            // If no audio track, AVController needs to know to run in 'Video Only' mode (fallback clock)
            // For now, assuming audio exists as per prototype constraints
            this.avController.initAudio(); // Ensure context is ready
        }
        this.trigger('loadedmetadata');
        // Signal that we have enough data to start
        this.trigger('loadeddata');
        this.trigger('canplay');
    }

    setupVideoDecoder(config) {
        // config: { codec, description (Array), codedWidth, codedHeight }
        if (!('VideoDecoder' in window)) {
            console.error('WebCodecs VideoDecoder not supported');
            return;
        }

        // Prepare Description
        let description = null;
        if (config.description && Array.isArray(config.description)) {
            description = new Uint8Array(config.description);
        }

        const decoderConfig = {
            codec: config.codec,
            codedWidth: config.codedWidth,
            codedHeight: config.codedHeight
        };

        if (description) {
            decoderConfig.description = description;
        }

        console.log('[MkvWasmTech] Configuring VideoDecoder:', decoderConfig);

        this.videoDecoder = new VideoDecoder({
            output: this.handleVideoFrame.bind(this),
            error: (e) => console.error('VideoDecoder error:', e)
        });

        try {
            this.videoDecoder.configure(decoderConfig);
        } catch (e) {
            console.error('[MkvWasmTech] VideoDecoder Configuration Failed:', e);
        }
    }

    setupAudioDecoder(config) {
        if (!('AudioDecoder' in window)) {
            console.error('WebCodecs AudioDecoder not supported');
            return;
        }
        this.audioDecoder = new AudioDecoder({
            output: this.handleAudioFrame.bind(this),
            error: (e) => console.error('AudioDecoder error:', e)
        });
        this.audioDecoder.configure(config);
    }

    queuePacket(packet) {
        // packet: { trackId, timestamp, isKey, data }
        if (this.videoDecoder && packet.trackId === this.videoTrackId) {
            try {
                // console.log(`[MkvWasmTech] Queueing Packet. TS: ${packet.timestamp}, Key: ${packet.isKey}, Size: ${packet.data.byteLength}`);
                const chunk = new EncodedVideoChunk({
                    type: packet.isKey ? 'key' : 'delta',
                    timestamp: packet.timestamp * 1000, // ms -> microseconds
                    data: packet.data
                });
                this.videoDecoder.decode(chunk);
            } catch (e) {
                console.error('[MkvWasmTech] Decode Error:', e);
            }
        } else if (this.audioDecoder) {
            // Audio logic to be implemented fully later, for now check trackId if we had audioTrackId
            // const chunk = new EncodedAudioChunk(packet.chunk);
            // this.audioDecoder.decode(chunk);
        }
    }

    handleVideoFrame(frame) {
        this.avController.enqueueVideoFrame(frame);
    }

    handleAudioFrame(frame) {
        this.avController.enqueueAudioData(frame);
    }

    cleanup() {
        if (this.worker) this.worker.terminate();
        if (this.videoDecoder) this.videoDecoder.close();
        if (this.audioDecoder) this.audioDecoder.close();
        if (this.audioContext) this.audioContext.close();
    }

    // Required by Video.js Tech
    isSupported() { return true; }
    static isSupported() { return true; }
    static canPlaySource(source) {
        return source.type === 'video/x-matroska' || source.type === 'video/mkv';
    }
}

// Register
Tech.registerTech('MkvWasm', MkvWasmTech);
