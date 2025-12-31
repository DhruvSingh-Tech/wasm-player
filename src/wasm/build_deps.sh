#!/bin/bash
set -e


# Resolve script directory to handle running from any location
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
# Target the 'deps' directory at the project root
DEPS_DIR="$SCRIPT_DIR/../../deps"

mkdir -p "$DEPS_DIR"
cd "$DEPS_DIR"

# 1. Build libebml
if [ ! -d "libebml" ]; then
  git clone https://github.com/Matroska-Org/libebml.git
fi

cd libebml
mkdir -p build
cd build
emcmake cmake .. -DBUILD_SHARED_LIBS=OFF -DCMAKE_INSTALL_PREFIX=$(pwd)/../../install
emmake make -j4
emmake make install
cd ../..

# 2. Build libmatroska
if [ ! -d "libmatroska" ]; then
  git clone https://github.com/Matroska-Org/libmatroska.git
fi

cd libmatroska
mkdir -p build
cd build
# Point to libebml install
emcmake cmake .. \
    -DBUILD_SHARED_LIBS=OFF \
    -DCMAKE_INSTALL_PREFIX=$(pwd)/../../install \
    -DEBML_DIR=$(pwd)/../../install/lib/cmake/EBML
emmake make -j4
emmake make install
cd ../..

echo "Dependencies built successfully in deps/install"
