use clap::Parser;
use std::path::PathBuf;

pub const SESSION_TTL_SECS: u64 = 30 * 86400; // 30 days
pub const ACCESS_CODE_MIN: u32 = 100_000;
pub const ACCESS_CODE_MAX: u32 = 999_999;

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
    version = "0.1.0",
    about = "A tiny cross-platform file transfer assistant for your local network"
)]
pub struct Config {
    /// Listen address
    #[arg(long, default_value = "0.0.0.0:8080")]
    pub addr: String,

    /// Use this access code for this run only (does not overwrite the stored code)
    #[arg(long)]
    pub password: Option<String>,

    /// Override the data directory
    #[arg(long)]
    pub data_dir: Option<PathBuf>,

    /// One-shot run: temp data dir, fresh access code, cleanup on exit
    #[arg(long)]
    pub ephemeral: bool,

    /// Generate a new access code, invalidate old sessions, keep all data
    #[arg(long)]
    pub reset_code: bool,

    /// Maximum upload size in bytes
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

    /// Whether the persisted auth (access code hash + secret) should be
    /// created/loaded. A runtime --password override skips persistence.
    pub fn uses_persisted_auth(&self) -> bool {
        self.password.is_none()
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
