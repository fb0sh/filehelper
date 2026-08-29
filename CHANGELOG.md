# Changelog

All notable changes to FileHelper are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## 1.0.0 — 2026-08-30

### Highlights

- **User-defined CODE encrypted spaces** — no accounts, no registration,
  no server-generated password. The same CODE on another device opens the
  same encrypted messages and files; a different CODE is a fully separate
  space.
- **End-to-end encrypted text and files** — the CODE is derived in the
  browser (Scrypt → HKDF domain separation) into auth/message/file keys;
  the server stores ciphertext only and never sees the CODE, message
  text, filenames, or file contents.
- **Multi-device realtime sync** — space-scoped WebSocket delivery of
  encrypted messages between browsers sharing a CODE.
- **Client-side search with direct result navigation** — searches run over
  decrypted in-memory history (the server can't search for you), jump
  straight to the newest match, highlight every matching term in text and
  filenames, and keep navigating with ↑/↓/Enter/Shift+Enter.
- **Encrypted image preview** — images decrypt locally, pass a magic-header
  check, then preview in the browser. Videos and audio are always
  download-only file cards.
- **Telegram-style operations** — selected-text Copy, right-click menus,
  checkbox multi-select with a selection plate, and confirmed batch delete.
- **Desktop and mobile UI** with light/dark themes.
- **Single-binary deployment** — Rust backend with the React frontend
  embedded; SQLite persistence.
