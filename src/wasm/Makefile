EMCC = emcc
SRCS = mkv_demuxer.cpp
OUT = mkv_demuxer.js

# Paths to dependencies
DEPS_ROOT = ../../deps/install
INCLUDE_PATH = -I$(DEPS_ROOT)/include
LIB_PATH = -L$(DEPS_ROOT)/lib

# Flags:
# -O3: Optimize for speed
# -lembind: Use Embind for C++ classes
# -s ALLOW_MEMORY_GROWTH=1: Allow WASM memory to grow
# -s MODULARIZE=1: Output a module factory function
# -s ENVIRONMENT=worker: Optimize for worker usage
# -lebml -lmatroska: Link against built libraries
FLAGS = -std=c++17  -O3 -lembind -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s 'EXPORT_NAME="createDemuxer"' -s ENVIRONMENT=worker \
        $(INCLUDE_PATH) $(LIB_PATH) -lmatroska -lebml -fstack-protector

all: $(OUT)

$(OUT): $(SRCS)
	$(EMCC) $(SRCS) -o $(OUT) $(FLAGS)

clean:
	rm -f $(OUT) $(OUT:.js=.wasm)
