# WASM Based MKV-Player

An advanced web video player capable of playing **MKV (Matroska)** files directly in the browser—**without server-side transcoding**. 

This project demonstrates the power of modern web technologies, combining the safety and speed of WebAssembly with the raw performance of WebCodecs.

##  Key Features

*   **Native-Grade Parsing**: Uses **WebAssembly (WASM)** compiled from `libmatroska` (C++) to parse complex MKV containers efficiently and safely.
*   **Hardware Acceleration**: Leverages the **WebCodecs API** (`VideoDecoder` & `AudioDecoder`) to decode video streams using the device's specialized hardware.
*   **Zero-Copy Design**: Optimizes data flow between the Demuxer (WASM) and Decoder (JS) to minimize memory overhead.
*   **Non-Blocking UI**: Entire fetch and demux pipeline runs in a dedicated **Web Worker**, ensuring the main thread stays free for smooth UI rendering.
*   **Video.js Integration**: Implemented as a custom "Tech" for Video.js, retaining the rich ecosystem of plugins and UI controls.

## Documentation

Detailed documentation is available in the repository:

*   **[Installation Guide](./INSTALL.md)**: Full setup instructions, including Emscripten (WASM compiler) and dependency management.
*   **[Testing Guide](./TESTING.md)**: How to verify your build and run manual playback tests.

## Architecture

The player operates on a multi-threaded pipeline:

1.  **Main Thread (Consumer)**:
    *   **Video.js UI**: Handles user input (play/pause/seek).
    *   **Renderer**: `AVController` receives decoded VideoFrames and renders them to a `<canvas>`.
    *   **Audio Sync**: Uses `AudioContext` to schedule and play decoded PCM audio.

2.  **Web Worker (Producer)**:
    *   **Fetcher**: Loads file chunks via HTTP Range Requests (Smart buffering).
    *   **Demuxer (WASM)**: Pipes binary data into the C++ `MkvDemuxer` class.
    *   **Packetizer**: Extracts compressed video/audio packets and transfers them to the Main Thread.

## ⚡ Quick Start

If you have **Node.js** and **Emscripten** set up, you can start quickly:

```bash
# 1. Install Dependencies
npm install

# 2. Build the WASM Module
cd src/wasm
make
cd ../..

# 3. Start the Dev Server
npm run dev
```

Visit `http://localhost:5173` to see the player in action.

## Project Structure

*   `src/player/` - Video.js integration and AVController (Render loop).
*   `src/wasm/` - C++ Source code (`mkv_demuxer.cpp`) and Makefile.
*   `src/worker/` - The Web Worker bridging JS and WASM.
*   `deps/` - Pre-compiled static libraries for `libebml` and `libmatroska`.
