# MobileDAW native audio engine (C++17). Built two ways from the same sources:
#  - desktop: cmake -S native -B build/native && cmake --build build/native  -> golden_host (golden tests, tools/golden/golden.mjs)
#  - Android: android/app/src/main/cpp/CMakeLists.txt adds this directory and links mdaw_engine into the JNI library with Oboe
cmake_minimum_required(VERSION 3.18)
project(mobiledaw_engine CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

add_library(mdaw_engine STATIC
  engine/engine.cpp engine/commands.cpp engine/tmap.cpp engine/meter.cpp engine/units.cpp engine/instruments.cpp engine/inst_live.cpp engine/poli.cpp engine/drift.cpp engine/operator.cpp engine/analog.cpp engine/meld.cpp engine/simpler.cpp engine/fx.cpp engine/fx2.cpp engine/fx3.cpp engine/fx3b.cpp engine/fx4.cpp)
target_include_directories(mdaw_engine PUBLIC engine)
# Same results as the JS engine: no fused multiply-add, no fast-math reassociation (see engine/jsmath.h)
target_compile_options(mdaw_engine PUBLIC -ffp-contract=off -fno-fast-math -Wall -Wno-misleading-indentation)

if(NOT ANDROID)
  add_executable(golden_host host/golden_host.cpp)
  target_link_libraries(golden_host mdaw_engine)
endif()
