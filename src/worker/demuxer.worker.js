
// demuxer.worker.js
import createDemuxer from '../wasm/mkv_demuxer.js';

let demuxer = null;
let fetching = false;
let abortController = null;

// Track state
let tracksFound = false;
let currentUrl = null;
let seekTargetTime = -1; // -1 means no seek pending
let videoTrackId = null;

self.onmessage = async (e) => {
    const { cmd, url, time } = e.data;
    switch (cmd) {
        case 'init':
            await initWasm();
            break;
        case 'fetch':
            if (fetching) {
                if (abortController) abortController.abort();
                fetching = false;
            }
            if (!demuxer) {
                try {
                    await initWasm();
                } catch (e) {
                    console.error('Lazy WASM Init Failed:', e);
                    return;
                }
            }
            currentUrl = url;
            seekTargetTime = -1;
            videoTrackId = null;
            startStream(url);
            break;
        case 'seek':
            console.log('Worker: Seeking to', time);
            if (!currentUrl) {
                console.error('Worker: Cannot seek, no URL set');
                return;
            }
            // Stop current stream
            if (abortController) abortController.abort();
            fetching = false;

            // Wait a tick for cleanup?
            setTimeout(async () => {
                // Reset demuxer to clear buffers
                if (demuxer) {
                    demuxer.delete();
                    demuxer = null;
                }
                await initWasm(); // Re-init fresh

                // Set C++ optimization target (seconds)
                // This makes C++ skip packets internally without copying data
                if (demuxer) {
                    demuxer.seek(time);
                }

                seekTargetTime = time * 1000; // Keep JS check for safety (ms)
                startStream(currentUrl);
            }, 10);
            break;
        case 'close':
            fetching = false;
            break;
    }
};

async function initWasm() {
    try {
        const module = await createDemuxer();
        demuxer = new module.MkvDemuxer();
        // console.log('Worker: REAL WASM Demuxer Initialized');
        self.postMessage({ type: 'ready' });
    } catch (err) {
        console.error('Worker: WASM Init failed', err);
        self.postMessage({ type: 'error', error: 'WASM Init Failed' });
    }
}

async function startStream(url) {
    fetching = true;
    tracksFound = false; // We will re-find tracks, but we might want to skip metadata event? 
    // Actually, fine to re-send metadata or we can flag it.
    abortController = new AbortController();

    try {
        const response = await fetch(url, { signal: abortController.signal });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }
        if (!response.body) throw new Error('No body');

        const reader = response.body.getReader();

        while (fetching) {
            const { done, value } = await reader.read();
            if (done) break;

            if (!demuxer) break;

            // Push data to C++
            demuxer.push_data(value);

            if (!tracksFound) {
                const metadata = demuxer.get_metadata();
                if (metadata && metadata.videoTrack) {
                    // console.log('Worker: Tracks found!');
                    videoTrackId = metadata.videoTrack.trackId;
                    if (seekTargetTime < 0) {
                        self.postMessage({ type: 'metadata', data: metadata });
                    }
                    tracksFound = true;
                }
            }

            if (tracksFound) {
                try {
                    let packet;
                    while ((packet = demuxer.read_packet()) != null) {
                        // Handle Seek Skipping
                        // Handle Seek Skipping
                        if (seekTargetTime >= 0) {
                            if (packet.timestamp < seekTargetTime) {
                                // Skip this packet
                                continue;
                            }

                            // Reached time target. 
                            // Ensure we start on a Video Keyframe to prevent decoding errors (freeze)
                            if (videoTrackId !== null) {
                                if (packet.trackId === videoTrackId) {
                                    if (!packet.isKey) {
                                        continue; // Skip P-frames/B-frames until Keyframe
                                    }
                                    // Found Keyframe!
                                    // console.log('Worker: Seek synced at Keyframe', packet.timestamp);
                                    seekTargetTime = -1;
                                    self.postMessage({ type: 'seeked', timestamp: packet.timestamp });
                                } else {
                                    // Audio/Sub track. Skip until we sync video.
                                    continue;
                                }
                            } else {
                                // No video track, just time seek is enough
                                console.log('Worker: Seek reached target (No Video)', packet.timestamp);
                                seekTargetTime = -1;
                                self.postMessage({ type: 'seeked', timestamp: packet.timestamp });
                            }
                        }

                        // Normal processing
                        if (packet) {
                            if (packet.data && Array.isArray(packet.data)) {
                                packet.data = new Uint8Array(packet.data);
                            }

                            if (packet.data && packet.data.byteLength > 0) {
                                self.postMessage({
                                    type: 'packet',
                                    trackId: packet.trackId,
                                    timestamp: packet.timestamp,
                                    isKey: packet.isKey,
                                    data: packet.data
                                }, [packet.data.buffer]);
                            }
                        }
                    }
                } catch (e) {
                    console.error('WASM Read Packet Error:', e);
                }
            }

            await new Promise(r => setTimeout(r, 0));
        }
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Worker Stream Error', err);
        self.postMessage({ type: 'error', error: err.message });
    }
}
