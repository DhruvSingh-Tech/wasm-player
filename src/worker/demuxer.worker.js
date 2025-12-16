
// demuxer.worker.js
import createDemuxer from '../wasm/mkv_demuxer.js';

let demuxer = null;
let fetching = false;
let abortController = null;

// Track state
let tracksFound = false;

self.onmessage = async (e) => {
    const { cmd, url, time } = e.data;
    switch (cmd) {
        case 'init':
            await initWasm();
            break;
        case 'fetch':
            if (fetching) {
                if (abortController) abortController.abort();
            }
            if (!demuxer) {
                try {
                    await initWasm();
                } catch (e) {
                    console.error('Lazy WASM Init Failed:', e);
                    return;
                }
            }
            startStream(url);
            break;
        case 'seek':
            console.log('Worker: Seeking (Not fully impl in C++ yet) to', time);
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
        console.log('Worker: REAL WASM Demuxer Initialized');
        self.postMessage({ type: 'ready' });
    } catch (err) {
        console.error('Worker: WASM Init failed', err);
        self.postMessage({ type: 'error', error: 'WASM Init Failed' });
    }
}

async function startStream(url) {
    fetching = true;
    tracksFound = false;
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
            if (done) {
                break;
            }

            if (!demuxer) {
                console.error('Demuxer is null inside fetch loop!');
                break;
            }

            // Push data to C++
            demuxer.push_data(value);

            if (!tracksFound) {
                const metadata = demuxer.get_metadata();
                if (metadata && metadata.videoTrack) {
                    console.log('Worker: Tracks found!', metadata);
                    self.postMessage({ type: 'metadata', data: metadata });
                    tracksFound = true;
                }
            }

            if (tracksFound) {
                // Loop to read all available packets in the buffer
                try {
                    let packet;
                    while ((packet = demuxer.read_packet()) != null) {
                        // Packet struct: { trackId, timestamp (ms), isKey, data (Uint8Array) }

                        // Transfer buffer to main thread
                        if (packet) {
                            // Convert JS Array to Uint8Array if needed (handling the C++ slow copy fix)
                            if (packet.data && Array.isArray(packet.data)) {
                                packet.data = new Uint8Array(packet.data);
                            }

                            if (packet.data && packet.data.byteLength > 0) {
                                // console.log('Worker: Received packet', packet.trackId, packet.timestamp);
                                self.postMessage({
                                    type: 'packet',
                                    trackId: packet.trackId,
                                    timestamp: packet.timestamp,
                                    isKey: packet.isKey,
                                    data: packet.data
                                }, [packet.data.buffer]);
                            } else {
                                console.log('Worker: Packet received but empty data');
                            }
                        }
                    }
                } catch (e) {
                    console.error('WASM Read Packet Error:', e, typeof e);
                    if (typeof e === 'number') {
                        // Was it a pointer? Maybe an Abort?
                        console.error('Thrown number usually means C++ throw or Abort. Value:', e);
                    }
                }
            } // End if tracksFound

            await new Promise(r => setTimeout(r, 0));
        }
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Worker Stream Error', err);
        self.postMessage({ type: 'error', error: err.message });
    }
}
