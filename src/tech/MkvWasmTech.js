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
        this.videoDecoder = null;
        this.audioDecoder = null;
        this.videoTrackId = null;
        this.audioTrackId = null;
        this.videoCanvas = null;
        this.ctx = null;
        this.audioContext = null;
        this.audioGain = null;
        this.audioNextTime = 0;

        this.currentLoop = null;
        this.isSeeking = false;
        this.internalPaused = true;
        this.isSeeking = false;

        this.bufferState = { video: [], audio: [] };
        this.readyState = 0; // HAVE_NOTHING
        this.duration_ = 0; // Will be set when metadata arrives

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

        // Sync initial volume/mute if options provided
        // Video.js might set this later, but let's be safe
        if (options.muted !== undefined) this.avController.setMuted(options.muted);
        if (options.volume !== undefined) this.avController.setVolume(options.volume);

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
        // Ensure canvas fills the container so clicks are registered
        this.videoCanvas.style.width = '100%';
        this.videoCanvas.style.height = '100%';
        this.videoCanvas.style.objectFit = 'contain';

        this.el_.appendChild(this.videoCanvas);
        this.ctx = this.videoCanvas.getContext('2d');

        // Click to Toggle Play/Pause
        this.videoCanvas.addEventListener('click', (e) => {
            if (this.paused()) {
                this.play();
            } else {
                this.pause();
            }
        });
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

        // Reset state
        this.internalPaused = true;
        this.trigger('pause'); // Ensure UI shows pause state initially

        if (!this.worker) this.initializeWorker();

        // Send fetch command
        this.worker.postMessage({ cmd: 'fetch', url: src });

        // Signal loading to Video.js
        this.trigger('loadstart');
        this.trigger('waiting');
    }

    async play() {
        console.log('[MkvWasmTech] play() called, internalPaused:', this.internalPaused);
        if (this.internalPaused) {
            try {
                this.internalPaused = false;
                await this.avController.play();

                // Trigger both Video.js event and DOM event to ensure UI updates
                this.trigger('play');
                this.el_.dispatchEvent(new Event('play', { bubbles: true }));

                this.trigger('playing');
                this.el_.dispatchEvent(new Event('playing', { bubbles: true }));
            } catch (e) {
                console.error('[MkvWasmTech] Play failed:', e);
                this.internalPaused = true;
                this.trigger('error', { code: 4, message: 'Playback Failed: ' + e.message });
            }
        }

        // Always start timeupdate interval for Video.js (idempotent)
        this.startTimeUpdateTimer();
    }

    startTimeUpdateTimer() {
        if (this.timeUpdateInterval) return;
        console.log('[MkvWasmTech] Starting timeupdate timer');

        this.timeUpdateInterval = setInterval(() => {
            if (!this.internalPaused) {
                const time = this.currentTime();

                // Update player cache directly
                if (this.player_) {
                    this.player_.cache_ = this.player_.cache_ || {};
                    this.player_.cache_.currentTime = time;
                }

                // Dispatch DOM event as well
                if (this.el_) {
                    this.el_.dispatchEvent(new Event('timeupdate', { bubbles: true }));
                }

                this.trigger('timeupdate');
            }
        }, 250);
    }

    stopTimeUpdateTimer() {
        if (this.timeUpdateInterval) {
            clearInterval(this.timeUpdateInterval);
            this.timeUpdateInterval = null;
        }
    }

    pause() {
        console.log('[MkvWasmTech] pause() called');
        this.internalPaused = true;
        this.avController.pause();
        this.stopTimeUpdateTimer();

        this.trigger('pause');
        if (this.el_) {
            this.el_.dispatchEvent(new Event('pause', { bubbles: true }));
        }
    }

    setCurrentTime(seconds) {
        console.log('[MkvWasmTech] setCurrentTime called:', seconds);
        this.isSeeking = true;

        // 1. Reset Decoders to abandon pending work/frames
        if (this.videoDecoder) {
            this.videoDecoder.reset();
            if (this.activeVideoConfig) {
                this.videoDecoder.configure(this.activeVideoConfig);
            }
        }
        if (this.audioDecoder) {
            this.audioDecoder.reset();
            if (this.activeAudioConfig) {
                this.audioDecoder.configure(this.activeAudioConfig);
            }
        }

        // 2. Clear AVController queues
        if (this.avController) {
            this.avController.seek(seconds);
        }

        // 3. Send seek command to worker (restarts demuxer & skips)
        if (this.worker) {
            this.worker.postMessage({ cmd: 'seek', time: seconds });
        }

        // 4. Update UI state
        this.trigger('seeking');
        // Show loading spinner
        this.trigger('waiting');
    }

    currentTime() {
        if (this.avController) {
            return this.avController.getMasterTime();
        }
        return 0;
    }

    duration() {
        // console.log('[MkvWasmTech] duration queried:', this.duration_);
        return this.duration_ || 0;
    }

    // Standard Tech Methods expected by Video.js
    playbackRate(rate) {
        if (rate === undefined) return 1;
        // Todo: Implement rate control in AVController
        return 1;
    }

    // Feature Flags for Video.js
    featuresVolumeControl = true;
    featuresPlaybackRate = true;
    featuresProgressEvents = true;
    featuresTimeupdateEvents = true;
    featuresNativeTextTracks = false; // We don't have native text tracks yet

    muted(muted) {
        if (muted === undefined) return this.avController ? this.avController.muted : false;
        if (this.avController) {
            console.log('[MkvWasmTech] setMuted:', muted);
            this.avController.setMuted(muted);
            this.trigger('volumechange');
            if (this.el_) this.el_.dispatchEvent(new Event('volumechange', { bubbles: true }));
        }
        return muted;
    }

    volume(vol) {
        if (vol === undefined) return this.avController ? this.avController.volume : 1;
        if (this.avController) {
            console.log('[MkvWasmTech] setVolume:', vol);
            this.avController.setVolume(vol);
            this.trigger('volumechange');
            if (this.el_) this.el_.dispatchEvent(new Event('volumechange', { bubbles: true }));
        }
        return vol;
    }

    seekable() {
        const duration = this.duration();
        console.log('[MkvWasmTech] seekable called. duration:', duration);
        const createTimeRanges = videojs.time?.createTimeRanges || videojs.createTimeRanges;
        if (duration === 0) return createTimeRanges();
        return createTimeRanges(0, duration);
    }

    buffered() {
        const duration = this.duration();
        const createTimeRanges = videojs.time?.createTimeRanges || videojs.createTimeRanges;
        if (duration === 0) return createTimeRanges();
        // Claim full buffer for seekability
        return createTimeRanges(0, duration);
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
                if (this.isSeeking) {
                    // console.log('[MkvWasmTech] Ignoring packet during seek');
                    return;
                }
                this.queuePacket(msg);
                break;
            case 'error':
                this.trigger('error', msg.error);
                break;
            case 'seeked':
                console.log('[MkvWasmTech] Worker seeked. Target TS (ms):', msg.timestamp);

                // Sync AVController to the ACTUAL timestamp we landed on (Keyframe)
                // This avoids AVController waiting for frames if we landed ahead of requested time
                // MSG timestamp is in ms, AVController expects seconds.
                if (this.avController) {
                    this.avController.seek(msg.timestamp / 1000);
                }

                this.isSeeking = false;
                this.trigger('seeked');
                break;
        }
    }

    handleMetadata(metadata) {
        console.log('[MkvWasmTech] Metadata Received:', metadata);
        // metadata: { duration, videoTrack, audioTracks }
        this.duration_ = metadata.duration;

        // Update player cache directly (workaround for Video.js not picking up tech.duration())
        if (this.player_) {
            this.player_.cache_ = this.player_.cache_ || {};
            this.player_.cache_.duration = metadata.duration;
        }

        // Setup Video and Audio Decoders

        // Configure Decoders
        if (metadata.videoTrack) {
            this.videoTrackId = metadata.videoTrack.trackId;
            this.setupVideoDecoder(metadata.videoTrack);
        }

        // Setup Audio Tracks
        if (metadata.audioTracks && metadata.audioTracks.length > 0) {
            // Get the AudioTrackList from the player (via tech's APIs if possible)
            // Or create our own internal list and expose it

            // Note: Video.js Techs usually interact with HTML5 tracks unless custom.
            // We'll access the player's AudioTrackList if available, or assume standard API.

            // For this environment, we assume we can add tracks to the player or tech
            // Video.js 7+ has specific API for this.

            // Let's store raw configs for switching
            this.audioTrackConfigs = {};
            metadata.audioTracks.forEach(t => {
                this.audioTrackConfigs[t.trackId] = t;
            });

            // Find specific AudioTrackList associated with this Tech
            const tracks = this.audioTracks();

            // Clear existing
            // tracks.on('change', null); // todo: clean up listeners
            // While we can't easily clear, we can assume new load.

            metadata.audioTracks.forEach((track, index) => {
                const audioTrack = new videojs.AudioTrack({
                    id: String(track.trackId),
                    kind: 'main',
                    label: track.label || `Track ${index + 1} (${track.codec})`,
                    language: track.language || 'und',
                    enabled: index === 0 // Enable first by default
                });
                tracks.addTrack(audioTrack);
            });

            // Listen for changes
            tracks.on('change', () => {
                for (let i = 0; i < tracks.length; i++) {
                    const track = tracks[i];
                    if (track.enabled) {
                        const trackId = parseInt(track.id);
                        if (this.audioTrackId !== trackId) {
                            console.log(`[MkvWasmTech] Switching to Audio Track ${trackId}`);
                            this.switchAudioTrack(trackId);
                        }
                        return;
                    }
                }
            });

            // Setup initial decoder
            const firstTrack = metadata.audioTracks[0];
            this.audioTrackId = firstTrack.trackId;
            this.setupAudioDecoder(firstTrack);

        } else {
            console.log('[MkvWasmTech] No audio tracks found');
            this.avController.initAudio(); // Ensure context is ready for video-only
        }

        // Setup Subtitle Tracks
        if (metadata.subtitleTracks && metadata.subtitleTracks.length > 0) {
            console.log('[MkvWasmTech] Subtitle Tracks:', metadata.subtitleTracks);
            this.subtitleTracksMap = {};
            // Clear existing tracks if possible?
            // Since we re-init tech, we should be fine.

            metadata.subtitleTracks.forEach((t, index) => {
                // Determine label
                let label = t.language || `Track ${index}`;
                if (t.codecId) label += ` (${t.codecId})`;

                const track = this.addTextTrack('subtitles', label, t.language || 'und');
                // Map trackId to the TextTrack object
                this.subtitleTracksMap[t.trackId] = track;

                console.log(`[MkvWasmTech] Added subtitle track: ${t.trackId} -> ${label}`);
            });
        }

        // Delay triggers to ensure listener attachment and proper state transition
        setTimeout(() => {
            console.log('[MkvWasmTech] Triggering Metadata Events');

            this.readyState = 4; // HAVE_ENOUGH_DATA

            // Video.js listens to DOM events on the tech element
            const opts = { bubbles: true, cancelable: false };
            this.el_.dispatchEvent(new Event('durationchange', opts));
            this.el_.dispatchEvent(new Event('loadedmetadata', opts));
            this.el_.dispatchEvent(new Event('loadeddata', opts));
            this.el_.dispatchEvent(new Event('canplay', opts));

            // Also trigger internal
            this.trigger('durationchange');
            this.trigger('loadedmetadata');
            this.trigger('loadeddata');
            this.trigger('canplay');
        }, 10);
    }

    switchAudioTrack(trackId) {
        const config = this.audioTrackConfigs[trackId];
        if (!config) return;

        this.audioTrackId = trackId;

        // 1. Close existing decoder
        if (this.audioDecoder) {
            this.audioDecoder.close();
            this.audioDecoder = null;
        }

        // 2. Clear queued audio
        this.avController.clearAudioQueue();

        // 3. Setup new decoder
        this.setupAudioDecoder(config);

        // 4. Seek to current time to restart stream for new track
        const now = this.currentTime();
        console.log(`[MkvWasmTech] Seek to ${now} to sync new audio track`);
        this.setCurrentTime(now);
    }

    setupVideoDecoder(config) {
        // config: { codec, codecId, description (Array), codedWidth, codedHeight }
        if (!('VideoDecoder' in window)) {
            console.error('WebCodecs VideoDecoder not supported');
            return;
        }

        console.log('[MkvWasmTech] Video Track Info:', {
            codec: config.codec,
            codecId: config.codecId,
            width: config.codedWidth,
            height: config.codedHeight,
            hasDescription: !!config.description
        });

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

        // Check if codec is supported
        VideoDecoder.isConfigSupported(decoderConfig).then((result) => {
            console.log('[MkvWasmTech] Codec Support Check:', result.supported, result.config);
            if (!result.supported) {
                console.error('[MkvWasmTech] Codec NOT SUPPORTED:', config.codec, config.codecId);
                return;
            }

            this.videoDecoder = new VideoDecoder({
                output: this.handleVideoFrame.bind(this),
                error: (e) => console.error('VideoDecoder error:', e)
            });

            try {
                this.activeVideoConfig = result.config || decoderConfig;
                this.videoDecoder.configure(this.activeVideoConfig);
                console.log('[MkvWasmTech] VideoDecoder configured successfully');
            } catch (e) {
                console.error('[MkvWasmTech] VideoDecoder Configuration Failed:', e);
            }
        }).catch((e) => {
            console.error('[MkvWasmTech] isConfigSupported error:', e);
        });
    }

    setupAudioDecoder(config) {
        // config: { codec, codecId, sampleRate, numberOfChannels, description }
        if (!('AudioDecoder' in window)) {
            console.error('WebCodecs AudioDecoder not supported');
            return;
        }

        console.log('[MkvWasmTech] Audio Track Info:', {
            codec: config.codec,
            codecId: config.codecId,
            sampleRate: config.sampleRate,
            numberOfChannels: config.numberOfChannels,
            hasDescription: !!config.description
        });

        // Prepare Description
        let description = null;
        if (config.description && Array.isArray(config.description)) {
            description = new Uint8Array(config.description);
        }

        const decoderConfig = {
            codec: config.codec,
            sampleRate: config.sampleRate,
            numberOfChannels: config.numberOfChannels
        };

        if (description) {
            decoderConfig.description = description;
        }

        // Check if codec is supported
        AudioDecoder.isConfigSupported(decoderConfig).then((result) => {
            console.log('[MkvWasmTech] Audio Codec Support Check:', result.supported, result.config);
            if (!result.supported) {
                console.error('[MkvWasmTech] Audio Codec NOT SUPPORTED:', config.codec, config.codecId);
                return;
            }

            this.audioDecoder = new AudioDecoder({
                output: this.handleAudioFrame.bind(this),
                error: (e) => console.error('AudioDecoder error:', e)
            });

            try {
                this.activeAudioConfig = result.config || decoderConfig;
                this.audioDecoder.configure(this.activeAudioConfig);
                console.log('[MkvWasmTech] AudioDecoder configured successfully');
                // Initialize audio context NOW so it's ready for incoming audio
                this.avController.initAudio();
            } catch (e) {
                console.error('[MkvWasmTech] AudioDecoder Configuration Failed:', e);
            }
        }).catch((e) => {
            console.error('[MkvWasmTech] Audio isConfigSupported error:', e);
        });
    }

    queuePacket(packet) {
        // packet: { trackId, timestamp, isKey, data }
        if (this.videoDecoder && packet.trackId === this.videoTrackId) {
            // Check decoder state before decoding
            if (this.videoDecoder.state !== 'configured') {
                return;
            }
            try {
                const chunk = new EncodedVideoChunk({
                    type: packet.isKey ? 'key' : 'delta',
                    timestamp: packet.timestamp * 1000, // ms -> microseconds
                    data: packet.data
                });
                this.videoDecoder.decode(chunk);
            } catch (e) {
                console.error('[MkvWasmTech] Video Decode Error:', e);
            }
        } else if (this.audioDecoder && packet.trackId === this.audioTrackId) {
            // Check decoder state before decoding
            if (this.audioDecoder.state !== 'configured') {
                return;
            }
            try {
                const chunk = new EncodedAudioChunk({
                    type: 'key',
                    timestamp: packet.timestamp * 1000, // ms -> microseconds
                    data: packet.data
                });
                this.audioDecoder.decode(chunk);
            } catch (e) {
                console.error('[MkvWasmTech] Audio Decode Error:', e);
            }
        } else if (this.subtitleTracksMap && this.subtitleTracksMap[packet.trackId]) {
            this.handleSubtitlePacket(packet);
        }
    }

    handleSubtitlePacket(packet) {
        const track = this.subtitleTracksMap[packet.trackId];
        if (!track) return;

        try {
            const text = new TextDecoder('utf-8').decode(packet.data);
            if (!text || text.trim().length === 0) return;

            const startTime = packet.timestamp / 1000; // ms -> seconds

            // Use packet duration if available (mkv gives duration in TimecodeScale units, usually ms)
            // packet.duration is just a raw number from C++ (unit depends on file, usually ms).
            // Let's assume ms if present.
            let duration = 4.0; // Default 4s
            if (packet.duration && packet.duration > 0) {
                duration = packet.duration / 1000.0;
            }

            const endTime = startTime + duration;

            // Debug 
            // console.log(`[MkvWasmTech] Subtitle: ${startTime} - ${endTime}: ${text}`);

            const Cue = window.VTTCue || window.TextTrackCue;
            const cue = new Cue(startTime, endTime, text);
            track.addCue(cue);

        } catch (e) {
            console.error('[MkvWasmTech] Subtitle Error:', e);
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
