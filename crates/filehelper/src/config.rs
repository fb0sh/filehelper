use clap::Parser;
use std::path::PathBuf;

/// Bearer session TTL: 24 hours. The client re-authenticates with its
/// derived auth key whenever the tab refreshes, so a shorter TTL is fine.
pub const SESSION_TTL_SECS: u64 = 24 * 3600;

/// Max encrypted text/file-message payload (opaque to the server).
pub const MAX_MESSAGE_PAYLOAD: usize = 256 * 1024; // 256 KiB

/// Max ids in one batch delete.
pub const MAX_BATCH_IDS: usize = 500;

/// Client-side plaintext chunk size (8 MiB). The server uses it only to
/// compute the maximum ciphertext overhead allowance.
pub const FILE_CHUNK_SIZE: u64 = 8 * 1024 * 1024;

/// XChaCha20-Poly1305 AEAD tag length.
pub const AEAD_TAG: u64 = 16;

/// Create-space rate limit.
pub const CREATE_LIMIT: usize = 10;
pub const CREATE_WINDOW_SECS: u64 = 60;

// Cross-platform application data directory, matching the spec:
//   Linux:   ~/.local/share/filehelper/
//   macOS:   ~/Library/Application Support/FileHelper/
//   Windows: %LOCALAPPDATA%\FileHelper\
#[cfg(target_os = "macos")]
const APP_DIR_NAME: &str = "FileHelper";
#[cfg(target_os = "windows")]
const APP_DIR_NAME: &str = "FileHelper";
#[cfg(all(unix, not(target_os = "macos")))]
const APP_DIR_NAME: &str = "filehelper";

#[derive(Parser, Debug, Clone)]
#[command(
    name = "filehelper",
    version = env!("CARGO_PKG_VERSION"),
    about = "A tiny end-to-end encrypted file transfer assistant for your local network"
)]
pub struct Config {
    /// Listen address
    #[arg(long, default_value = "0.0.0.0:8080")]
    pub addr: String,

    /// Override the data directory
    #[arg(long)]
    pub data_dir: Option<PathBuf>,

    /// One-shot run: OS temp data dir, removed on graceful exit
    #[arg(long)]
    pub ephemeral: bool,

    /// Maximum upload size in bytes (plaintext; the server enforces the
    /// matching ciphertext bound including AEAD overhead)
    #[arg(long, default_value = "10737418240")]
    pub max_upload_size: u64,
}

impl Config {
    /// Resolve the data directory for this run.
    pub fn resolve_data_dir(&self) -> Result<PathBuf, String> {
        if self.ephemeral {
            let tmp = std::env::temp_dir().join(format!("filehelper-ephemeral-{}", random_hex(8)));
            return Ok(tmp);
        }
        if let Some(dir) = &self.data_dir {
            return Ok(dir.clone());
        }
        default_app_data_dir()
    }
}

pub fn default_app_data_dir() -> Result<PathBuf, String> {
    directories::ProjectDirs::from("", "", APP_DIR_NAME)
        .map(|d| d.data_dir().to_path_buf())
        .ok_or_else(|| "Could not determine the application data directory".to_string())
}

fn random_hex(len: usize) -> String {
    let bytes: Vec<u8> = (0..len).map(|_| rand::random::<u8>()).collect();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
