#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Building FileHelper ==="
echo ""
echo "1. Installing frontend dependencies..."
pnpm install --frozen-lockfile

echo ""
echo "2. Building frontend..."
pnpm --dir web build

echo ""
echo "3. Building release binary..."
cargo build --release

echo ""
echo "=== Done ==="
echo "Binary: $(pwd)/target/release/filehelper"
echo ""
echo "Run: ./target/release/filehelper --addr 0.0.0.0:8080 --password 123"
