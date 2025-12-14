# Production-Grade MKV WASM Player

This project implements a high-performance MKV player for the browser using:
- **Video.js** for the UI and state management.
- **WebAssembly (WASM)** for parsing MKV (Matroska) containers (via `libmatroska`).
- **WebCodecs** (VideoDecoder/AudioDecoder) for hardware-accelerated decoding.
- **Web Workers** to offload fetching and demuxing from the main thread.

## Architecture

1.  **Main Thread**: Handles the UI, renders video frames to a Canvas, and manages Audio sync.
2.  **Worker Thread**: Fetches file chunks via HTTP Range Requests, pipes them to the WASM demuxer, and emits extracted packets.
3.  **WASM Demuxer**: compiled C++ code (using `libmatroska` and `libebml`) that safely parses untrusted file data.

## Prerequisites

- Node.js & npm
- Emscripten SDK (for compiling the WASM module)

## Setup

1.  Install dependencies:
    ```bash
    npm install
    ```

2.  **Compile the WASM Module**:
    The C++ source is located in `src/wasm/mkv_demuxer.cpp`.
    You need `libmatroska` and `libebml` headers/libs available for Emscripten, or you must adapt the Makefile to include them.
    
    ```bash
    cd src/wasm
    make
    ```
    *Note: This will generate `mkv_demuxer.js` and `mkv_demuxer.wasm`.*

3.  Run the Development Server:
    ```bash
    npm run dev
    ```

## Development Status

- **Demuxer**: C++ source provided. Needs compilation. (Mock metadata currently used in worker for testing UI).
- **Decoder**: WebCodecs integration complete.
- **Rendering**: Canvas-based rendering pipeline active.
