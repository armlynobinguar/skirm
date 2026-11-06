#!/usr/bin/env bash
# Builds the seven skirm contracts (skills, market, registry, deposits, seasons, badges, backing)
# to wasm in target/wasm32-unknown-unknown/release/.
#
# near-sdk needs `std`, which the wasm32v1-none target does not have, so this builds for
# wasm32-unknown-unknown and rebuilds std with `-C target-cpu=mvp` (no post-MVP wasm features
# such as bulk-memory or sign-ext that nearcore may reject). `-Z build-std` is a nightly flag;
# RUSTC_BOOTSTRAP=1 enables it on the stable toolchain. Needs the `rust-src` component
# (`rustup component add rust-src`); the wasm32-unknown-unknown std does not need to be installed.
set -euo pipefail
cd "$(dirname "$0")"

RUSTC_BOOTSTRAP=1 \
RUSTFLAGS="-C target-cpu=mvp -C link-arg=-s" \
  cargo build --release --target wasm32-unknown-unknown -Z build-std=std,panic_abort "$@"

ls -l target/wasm32-unknown-unknown/release/skirm_*.wasm
