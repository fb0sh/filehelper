#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

echo "=== Building frontend ==="
cd web
pnpm install --frozen-lockfile 2>&1 || true
npx vite build
cd ..

echo ""
echo "=== Building release binary ==="
cargo build --release

echo ""
echo "Binary: ./target/release/filehelper"
echo "Run: ./target/release/filehelper --addr 0.0.0.0:8080 --password 123"