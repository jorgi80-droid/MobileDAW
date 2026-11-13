// A mutex for the two places the engine's app-thread code locks (staged SoundFont data, wavetable builds). The WebAssembly build is
// single-threaded and its libc++ has no <mutex>: there the lock is a no-op.
#pragma once
#ifdef MDAW_WASM
namespace mdaw { struct MdMutex {}; struct MdLock { explicit MdLock(MdMutex&) {} }; }
#else
#include <mutex>
namespace mdaw { using MdMutex = std::mutex; using MdLock = std::lock_guard<std::mutex>; }
#endif
