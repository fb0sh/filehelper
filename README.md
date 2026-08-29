# FileHelper

A tiny cross-platform file transfer assistant for your local network, powered by Rust.

![FileHelper](docs/screenshots/desktop-main.png)

## Quick Start

Linux / macOS:

```bash
./filehelper
```

Windows:

```text
filehelper.exe
```

Then open what the terminal prints:

```text
Open:          http://192.168.1.23:8080
Access code:   483921
```

Enter the access code in the browser and start sending text and files. The
default data is kept in FileHelper's application data directory
(`~/.local/share/filehelper`, `~/Library/Application Support/FileHelper`, or
`%LOCALAPPDATA%\FileHelper`), so a restart continues where you left off — same
access code, same messages, same files.

## Features

- Telegram-like Web UI (desktop double column + mobile single column, light & dark)
- Text, file, image, video and audio transfer
- Drag & drop and clipboard image paste
- Real-time sync across browsers via WebSocket
- Full-text search (FTS5) with jump-to-message
- SQLite persistence, files stored on disk under UUID names
- Access code authentication (no accounts)
- Streaming upload/download with HTTP Range support
- Single binary, no runtime dependencies

## Modes

```bash
# Default: comfortable mode — restores previous data and access code
./filehelper

# One-shot mode — temp data, fresh access code, everything removed on exit
./filehelper --ephemeral

# New access code — old browser sessions become invalid, data is kept
./filehelper --reset-code
```

That is the whole model: `filehelper` keeps your stuff, `--reset-code` rotates
the code, `--ephemeral` leaves no trace.

## Usage

```bash
filehelper [OPTIONS]

--addr <ADDR>            Listen address (default: 0.0.0.0:8080)
--password <PASSWORD>    Access code for this run only (does not overwrite the stored code)
--data-dir <PATH>        Override the data directory
--ephemeral              One-shot run: temp data dir, cleanup on exit
--reset-code             Generate a new access code, keep all data
--max-upload-size <SIZE> Max upload size in bytes (default: 10 GiB)
--version, --help
```

## Data Storage

```
<data dir>/
├── filehelper.db   # SQLite database (messages, attachments, FTS, auth hash)
├── files/          # Stored files, UUID-named
├── tmp/            # In-flight upload parts
├── trash/          # Deleted files awaiting final removal
└── secret          # Access code + session signing key (user-readable only)
```

## Build from Source

Requirements: Rust 1.80+, Node.js 20+, pnpm.

```bash
pnpm --dir web install --frozen-lockfile
pnpm --dir web build        # builds web/dist (embedded into the binary)
cargo build --release
# binary: ./target/release/filehelper
```

## Development

```bash
mise run dev    # backend :8080 + Vite :5173 with /api proxy
mise run test   # fmt + clippy + Rust tests + frontend tests
mise run build  # frontend build + release binary
```

## Security

- Access code (6 digits, CSPRNG) protects every API route; only `/api/v1/info`,
  `/api/v1/auth/login` and `/api/v1/auth/session` are unauthenticated.
- The access code is stored as an Argon2id hash; verification is
  constant-time. Login is rate-limited per IP (5 failures / minute).
- Sessions are stateless HMAC-SHA256 signed cookies (HttpOnly, SameSite=Strict,
  30-day TTL) — restarting keeps browsers signed in; `--reset-code` rotates
  the signing key so all old sessions are invalidated.
- Files are stored under UUID names; original filenames (any Unicode) live only
  in the database, so path traversal is impossible.

Access code controls who can reach the app, but plain HTTP does not encrypt
traffic. For public Wi-Fi or untrusted networks, put FileHelper behind
Tailscale, WireGuard, or an HTTPS reverse proxy.

## API Overview

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/login` | Verify access code, set session cookie |
| POST | `/api/v1/auth/logout` | Clear session cookie |
| GET | `/api/v1/auth/session` | Check session |
| GET | `/api/v1/messages` | List messages (cursor pagination) |
| POST | `/api/v1/messages` | Send a text message |
| GET | `/api/v1/messages/{id}/context` | Message window for search jump |
| DELETE | `/api/v1/messages/{id}` | Delete a message (and its file) |
| POST | `/api/v1/clear` | Clear all messages and files |
| POST | `/api/v1/uploads` | Upload one file (multipart) |
| GET | `/api/v1/files/{id}/content` | Inline file content (Range support) |
| GET | `/api/v1/files/{id}/download` | Attachment download |
| GET | `/api/v1/search` | Full-text search |
| GET | `/api/v1/storage` | Storage statistics |
| GET | `/api/v1/ws` | WebSocket realtime |
| GET | `/api/v1/info` | Server info |

## License

MIT
