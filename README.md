# FileHelper

A tiny self-hosted file transfer assistant with a Telegram-like web interface, powered by Rust.

![FileHelper](docs/screenshots/desktop.png)

## Features

- Telegram-like Web UI (light & dark)
- Text and file transfer
- Images, video, and audio support
- Drag & drop and clipboard image paste
- Real-time sync across browsers via WebSocket
- Full-text search (FTS5)
- SQLite persistence
- Single binary deployment
- Password authentication
- Streaming upload/download with Range support
- Mobile responsive

## Quick Start

```bash
./filehelper --addr 0.0.0.0:8080 --password 123
```

Then open http://localhost:8080

## Installation

Download the latest binary from the [releases page](https://github.com/fb0sh/filehelper/releases), or build from source.

## Usage

```bash
# Basic usage
./filehelper --addr 0.0.0.0:8080 --password your-password

# Custom data directory
./filehelper --addr 0.0.0.0:8080 --password 123 --data-dir ./my-data

# Disable auth (not recommended)
./filehelper --addr 127.0.0.1:8080 --no-auth

# Use environment variable for password
export FILEHELPER_PASSWORD=your-password
./filehelper --addr 0.0.0.0:8080
```

## Configuration

| Flag | Env | Default | Description |
|------|-----|---------|-------------|
| `--addr` | - | `127.0.0.1:8080` | Listen address |
| `--password` | `FILEHELPER_PASSWORD` | - | Auth password |
| `--password-file` | - | - | Path to password file |
| `--data-dir` | - | `./data` | Data directory |
| `--max-upload-size` | - | `10737418240` | Max upload size in bytes (10GiB) |
| `--session-ttl` | - | `30d` | Session TTL (e.g., `30d`, `24h`) |
| `--name` | - | `FileHelper` | App display name |
| `--no-auth` | - | - | Disable authentication |

## Data Storage

All data is stored in `--data-dir` (default: `./data/`):

```
data/
├── filehelper.db    # SQLite database
├── files/           # Uploaded files (UUID-named)
├── tmp/             # Temporary upload parts
└── trash/           # Deleted file staging
```

## Build from Source

Requirements:
- Rust 1.80+
- Node.js 20+
- pnpm

```bash
# Install frontend dependencies
pnpm install --frozen-lockfile

# Build frontend
pnpm --dir web build

# Build release binary
cargo build --release

# The binary is at:
./target/release/filehelper
```

## Development

```bash
# Terminal 1: Start Rust backend
cargo run -p filehelper -- --addr 127.0.0.1:8080 --password 123

# Terminal 2: Start Vite dev server
pnpm --dir web dev
```

Vite dev server runs on `:5173` and proxies `/api` to `:8080`.

## Security

- Passwords are hashed with Argon2id
- Sessions use HMAC-signed cookies (HttpOnly, SameSite=Strict)
- All mutations require `X-FileHelper-Request: 1` header
- Files are stored with UUID names, not user-supplied names
- MIME-type sniffing protection
- Content-Security-Policy headers

## Backup

To back up your data:

```bash
# Stop the server, then copy the data directory
cp -r data/ backup/
```

## API Overview

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/auth/logout` | Logout |
| GET | `/api/v1/auth/session` | Check session |
| GET | `/api/v1/messages` | List messages (cursor pagination) |
| POST | `/api/v1/messages` | Send text message |
| DELETE | `/api/v1/messages/{id}` | Delete message |
| POST | `/api/v1/uploads` | Upload file (multipart) |
| GET | `/api/v1/files/{id}/content` | Get file content (inline) |
| GET | `/api/v1/files/{id}/download` | Download file (attachment) |
| GET | `/api/v1/search` | Search messages |
| GET | `/api/v1/storage` | Storage stats |
| GET | `/api/v1/ws` | WebSocket realtime |
| GET | `/api/v1/info` | Server info |

## License

MIT