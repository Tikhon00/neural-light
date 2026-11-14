#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/neural-ddp-tests.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT
compiler=${CXX:-clang++}
"$compiler" -std=c++11 -Wall -Wextra -Wpedantic -Werror -O1 -g \
  -fsanitize=address,undefined -fno-omit-frame-pointer \
  -I firmware/include firmware/tests/frame_receiver_test.cpp -o "$test_dir/receiver-tests"
"$test_dir/receiver-tests" firmware/tests/mac-ddp-1000.hex

# Where Swift is available, also verify the committed fixture against the actual
# shipping Mac encoder. Linux C++ CI still reads and checks the same fixture.
if command -v swiftc >/dev/null 2>&1; then
  swiftc native/Sources/NeuralCore/Packets.swift firmware/tests/generate-fixtures.swift \
    -o "$test_dir/generate-fixtures"
  "$test_dir/generate-fixtures" > "$test_dir/mac-ddp-1000.hex"
  diff -u firmware/tests/mac-ddp-1000.hex "$test_dir/mac-ddp-1000.hex"
  printf 'Mac encoder fixture matches current Packets.swift.\n'
fi
