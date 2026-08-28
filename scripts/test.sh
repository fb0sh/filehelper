#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

echo "=== cargo fmt ==="
cargo fmt --check

echo "=== cargo clippy ==="
cargo clippy --workspace --all-targets --all-features -- -D warnings

echo "=== cargo test ==="
cargo test --test integration_test

echo "=== frontend test ==="
cd web && npx vitest run

echo ""
echo "=== All tests passed ==="