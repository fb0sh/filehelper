#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

echo "=== cargo fmt ==="
cargo fmt --check

echo "=== cargo clippy ==="
cargo clippy --workspace --all-targets --all-features -- -D warnings

echo "=== cargo test ==="
cargo test --workspace

echo "=== frontend lint ==="
cd web && npx eslint .

echo "=== frontend test ==="
npx vitest run

echo "=== frontend build ==="
npx vite build
cd ..

echo "=== cargo build --release ==="
cargo build --release

echo ""
echo "=== Release built ==="
ls -lh target/release/filehelper
