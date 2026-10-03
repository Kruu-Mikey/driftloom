#!/bin/sh
# Build the Rust core (core/) to WebAssembly and copy it to js/dlcore.wasm.
#
#   tools/build-core.sh          build, and replace js/dlcore.wasm
#   tools/build-core.sh --check  build, and fail if js/dlcore.wasm differs
#                                from the build by a single byte
#
# The built file is committed (roadmap 16): the site stays plain files with
# no build step, and the bytes that were checked are the bytes that ship.
# --check is what proves the committed file is its source. It runs on every
# PR (.github/workflows/core.yml), and it rests on the build being
# reproducible: core/rust-toolchain.toml pins the exact compiler, the
# crate has no dependencies, and the paths below are remapped so the file
# does not depend on where the repository or the toolchain sits.
#
# Needs rustup; the pinned toolchain and its wasm32 target install
# themselves on first use.

set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
check=no
case "${1:-}" in
  --check) check=yes ;;
  '') ;;
  *) echo "usage: tools/build-core.sh [--check]" >&2; exit 2 ;;
esac

cd "$root/core"
cargo_home=${CARGO_HOME:-$HOME/.cargo}
rustup_home=${RUSTUP_HOME:-$HOME/.rustup}
RUSTFLAGS="--remap-path-prefix=$root/core=/dlcore --remap-path-prefix=$cargo_home=/cargo --remap-path-prefix=$rustup_home=/rustup"
export RUSTFLAGS
cargo build --release --locked --target wasm32-unknown-unknown

built="$root/core/target/wasm32-unknown-unknown/release/dlcore.wasm"
committed="$root/js/dlcore.wasm"
size=$(wc -c < "$built" | tr -d ' ')

if [ "$check" = yes ]; then
  if [ ! -f "$committed" ]; then
    echo "build-core: js/dlcore.wasm is missing; run tools/build-core.sh and commit it" >&2
    exit 1
  fi
  if ! cmp -s "$built" "$committed"; then
    echo "build-core: js/dlcore.wasm does not match a build of core/ ($size bytes built," >&2
    echo "  $(wc -c < "$committed" | tr -d ' ') committed). Run tools/build-core.sh and commit the result." >&2
    exit 1
  fi
  echo "build-core: js/dlcore.wasm matches its source ($size bytes)"
else
  cp "$built" "$committed"
  echo "build-core: wrote js/dlcore.wasm ($size bytes)"
fi
