# Changelog

All notable changes to FileHelper are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## 2.0.3 — 2026-08-30

### Fixes

- **File uploads no longer crash over LAN HTTP.** `crypto.randomUUID()` is
  only available in secure contexts (HTTPS or localhost), so uploading
  from another device (`http://192.168.x.x:8080`) threw
  `TypeError: crypto.randomUUID is not a function`. Upload task ids now
  use a UUID built from `crypto.getRandomValues`, which works in every
  context. Regression test simulates the insecure context.

## 2.0.2 — 2026-08-30

### Changes

- **Sidebar width is now proportional** — the floating sidebar card is 29%
  of the total window width (`clamp(330px, 29vw, 520px)`), matching the
  Telegram left-column ratio instead of a fixed 430px. All desktop
  screenshots regenerated.

## 2.0.1 — 2026-08-30

### Fixes

- **Mobile chat now uses the same Telegram wallpaper as desktop.** The
  mobile layout previously painted a flat white/gray background; the
  shared wallpaper layer (green gradient field + doodle tile) is now
  applied to the mobile shell too, and the mobile chat column is
  transparent so the header / messages / composer float on the same green
  background. The mobile sidebar stays an opaque white sheet, matching
  Telegram mobile.

## 2.0.0 — 2026-08-30

### Highlights

- **Telegram Web K desktop shell** — the main screen is rebuilt around a
  windowed app shell: one continuous Telegram-style wallpaper covers the
  entire main content area (soft multi-point green gradient color field +
  a dense, seamless olive doodle tile), with the chat sidebar as a
  floating white rounded card on top of it and the chat header / messages
  / composer floating directly on the same wallpaper.
- **Floating sidebar card** — the left column is transparent; the white
  card (430px, 28px radius, layered soft shadow) reads as an island with
  wallpaper visible around and behind it. Telegram-style segmented filter
  tabs (All / Personal / Unread) inside a light rounded group, denser chat
  rows (72px, 54px avatars, 15px/500 titles), and a blue floating action
  button that focuses the search.
- **Rebuilt wallpaper art** — 1024×1024 seamless doodle tile with 400+
  natural, size-varied line-art glyphs (animals, plants, gifts, rockets,
  balloons, food…) plus a soft spatial gradient field; tiling seams are
  invisible and contrast stays low and olive-family in both themes.
- **Floating chat chrome** — header and composer remain white rounded
  pills aligned on one center axis with the message rail, while the chat
  content column itself is fully transparent (no panel, no card
  background) so messages float directly on the wallpaper.
- Everything else from 1.0.0 is unchanged: end-to-end encrypted CODE
  spaces, realtime multi-device sync, client-side search with result
  navigation, encrypted image previews, selection multi-delete, light/dark
  themes, single-binary deployment.

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
