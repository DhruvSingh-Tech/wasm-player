# Testing Guide for Prototype2 (MkvWasm Player)

This document outlines the steps to set up, build, and test the `prototype2` repository on a fresh system.

## 1. Prerequisites

Before starting, ensure you have the following installed:

*   **Node.js** (v18 or newer recommended)
*   **npm** (usually bundled with Node.js)
*   **Emscripten SDK (emsdk)**
    *   Required to compile the C++ WASM demuxer.
    *   Ensure `emcc` is in your PATH. [Installation Instructions](https://emscripten.org/docs/getting_started/downloads.html)

## 2. Dependencies & Installation

### Dependencies
The repository includes pre-compiled static libraries for `libebml` and `libmatroska` in the `deps/` directory at the project root. This simplifies the build process.
*   **Note**: There is a `build_deps.sh` script in `src/wasm/`, but it may build to a different directory (`src/wasm/deps`) than what the `Makefile` expects (`../../deps`). For a fresh clone, you should rely on the included `deps/` unless you need to rebuild them.

### Setup
Clone the repository and install Node.js dependencies:

```bash
# From the project root
npm install
```

## 3. Build the WebAssembly Module

The core MKV demuxing logic resides in C++ and must be compiled to WebAssembly.

1.  Activate Emscripten in your terminal (if not already active):
    ```bash
    source /path/to/emsdk/emsdk_env.sh
    ```

2.  Navigate to the WASM source directory and build:
    ```bash
    cd src/wasm
    make
    ```

    **Expected Output:**
    *   This command will compile `mkv_demuxer.cpp` using `emcc`.
    *   It generates two files: `mkv_demuxer.js` and `mkv_demuxer.wasm`.
    *   The build links against pre-compiled libraries found in `../../deps/install/lib` (`libebml.a`, `libmatroska.a`).

## 4. Running the Development Server

Start the Vite development server:

```bash
# From the project root
npm run dev
```

*   The server usually starts at `http://localhost:5173`.
*   Open this URL in a modern browser (Chrome/Edge/Firefox).

## 5. Testing & Verification

Since the project is in active development, "testing" primarily involves manual verification of the player's functionality.

### Initial Verification Steps
1.  **Open the Browser Console (F12)**: Keep this open to monitor logs.
2.  **Check for "Player Ready"**: You should see this log from `main.js` indicating Video.js initialized.
3.  **Check for Worker Initialization**: Look for logs like `Worker: REAL WASM Demuxer Initialized`.

### Playback Testing
The `src/main.js` file currently contains a **hardcoded source URL**.

1.  **If the video plays**:
    *   You verify that the WASM module loaded, downloaded the stream, demuxed it, and WebCodecs decoded it.
    *   Test the "FORCE PLAY" button (debug overlay) if auto-play fails.
    *   Test the "SEEK TO 60s" button to verify seeking logic.

2.  **If the video fails (403/Forbidden or 404)**:
    *   The hardcoded URL is likely a signed link that has expired.
    *   **Action**: Edit `src/main.js` and replace the `src` property in the `sources` array with a valid URL to an `.mkv` file (either a local file in `public/` or a valid remote URL).
    *   *Example update in `src/main.js`:*
        ```javascript
        sources: [{
            src: '/your_test_video.mkv', // Place file in 'public/' folder
            type: 'video/x-matroska'
        }]
        ```

### Common Issues
*   **WASM 404**: Ensure `mkv_demuxer.wasm` was generated in `src/wasm/` during step 3. Vite serves files from `src` correctly, but the worker needs to find it.
*   **CORS Errors**: If testing with remote URLs, ensure the server supports Cross-Origin requests (CORS) and Range requests.

## 6. Directory Structure Overview for Testers

*   `src/wasm/`: C++ source and Makefile.
*   `src/worker/`: The Web Worker (`demuxer.worker.js`) that bridges JS and WASM.
*   `src/player/`: Video.js-related logic.
*   `deps/`: Pre-compiled dependencies (`libebml`, `libmatroska`).
