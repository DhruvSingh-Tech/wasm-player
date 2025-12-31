# Installation & Setup Guide

This guide details the complete installation process for the `prototype2` MKV WASM Player.

## System Requirements
- **OS**: Linux, macOS, or Windows (via WSL2).
- **Node.js**: v16.0.0 or higher.
- **Emscripten SDK**: Latest version recommended for compiling C++ to WASM.

## 1. Environment Setup

### Install Node.js & npm
Ensure you have Node.js installed.
```bash
node --version
npm --version
```

### Install Emscripten (emsdk)
The core MKV demuxer is written in C++ and requires Emscripten to compile to WebAssembly.

1.  Clone the emsdk repo:
    ```bash
    git clone https://github.com/emscripten-core/emsdk.git
    cd emsdk
    ```
2.  Install and activate the latest SDK:
    ```bash
    ./emsdk install latest
    ./emsdk activate latest
    ```
3.  Add it to your path (run this in every terminal session or add to .bashrc):
    ```bash
    source ./emsdk_env.sh
    ```

## 2. Project Installation

1.  **Clone the Repository**:
    ```bash
    git clone <repo-url>
    cd prototype2
    ```

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

## 3. Building the WASM Module

The project ships with pre-compiled static libraries for `libebml` and `libmatroska` in the `deps/` folder. You only need to compile the project's own source code.

1.  Navigate to the WASM directory:
    ```bash
    cd src/wasm
    ```

2.  **Compile**:
    Ensure your `emsdk` environment is active (Step 1.3), then run:
    ```bash
    make
    ```

    **Successful Output**:
    *   Generates `mkv_demuxer.js` (The glue code).
    *   Generates `mkv_demuxer.wasm` (The binary module).

    *Troubleshooting*: If `make` fails saying `emcc: command not found`, ensure you ran `source emsdk_env.sh`.

## 4. Dependencies (Optional Rebuild)

The project includes pre-compiled static libraries for `libebml` and `libmatroska` in `deps/`.
If you need to strictly verify the build process or update these libraries:

1.  **Install CMake**:
    ```bash
    # Ubuntu/Debian
    sudo apt-get install cmake
    # macOS
    brew install cmake
    ```

2.  **Run the Build Script**:
    ```bash
    cd src/wasm
    chmod +x build_deps.sh
    ./build_deps.sh
    ```
    This will clone the repositories into `deps/` and compile them using your active Emscripten environment.

## 5. Running the Application

1.  Return to the project root:
    ```bash
    cd ../..
    ```

2.  Start the development server:
    ```bash
    npm run dev
    ```

3.  Access the player at the URL shown (usually `http://localhost:5173`).

## 5. Development Workflow

*   **JS Changes**: Vite will Hot-Module-Reload (HMR) automatically for changes in `src/player` or `src/main.js`.
*   **WASM Changes**: If you modify `src/wasm/mkv_demuxer.cpp`, you MUST re-run `make` in `src/wasm` and reload the browser page. The worker does not strictly HMR WASM binaries in all cases; a full refresh is safer.

## Directory Structure
- `src/wasm/`: C++ source code.
- `src/worker/`: Web Worker controller.
- `deps/install/`: Pre-compiled headers and archives for libmatroska/libebml.
