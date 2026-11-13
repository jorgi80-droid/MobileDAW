#!/bin/sh
# Builds js/engine/mdaw.wasm from native/engine + native/wasm/wasm_api.cpp. Needs clang, wasm-ld, wasi-libc and libc++ for wasm32
# (Ubuntu: apt-get install -y clang lld wasi-libc libc++-18-dev-wasm32 libclang-rt-18-dev-wasm32). Usage: sh native/wasm/build.sh
set -e
cd "$(dirname "$0")/.."
OUT=../js/engine/mdaw.wasm
clang++ --target=wasm32-wasi -std=c++17 -O2 -fno-exceptions -fno-rtti -ffp-contract=off -DMDAW_WASM=1 \
  -mexec-model=reactor -Wl,--no-entry -Wl,--strip-all -Wl,--export-dynamic -Wl,-z,stack-size=1048576 \
  -I engine engine/*.cpp wasm/wasm_api.cpp -o "$OUT"
ls -l "$OUT"
