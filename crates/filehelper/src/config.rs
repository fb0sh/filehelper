use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug, Clone)]
#[command(name = "filehelper", version = "0.1.0", about = "Self-hosted file transfer assistant")]
pub struct Config {
    /// Listen address
    #[arg(long, default_value = "127.0.0.1:8080")]
    pub addr: String,

    /// Password for authentication
    #[arg(long, env = "FILEHELPER_PASSWORD")]
    pub password: Option<String>,

    /// Path to a file containing the password
    #[arg(long)]
    pub password_file: Option<PathBuf>,

    /// Data directory
    #[arg(long, default_value = "./data")]
    pub data_dir: PathBuf,

    /// Maximum upload size in bytes
    #[arg(long, default_value = "10737418240")]
    pub max_upload_size: u64,

    /// Session TTL (e.g. "30d", "24h")
    #[arg(long, default_value = "30d")]
    pub session_ttl: String,

    /// Application display name
    #[arg(long, default_value = "FileHelper")]
    pub name: String,

    /// Disable authentication (not recommended)
    #[arg(long)]
    pub no_auth: bool,
}

impl Config {
    pub fn resolve_password(&self) -> Result<Option<String>, String> {
        if self.no_auth {
            return Ok(None);
        }
        if let Some(ref pw) = self.password {
            return Ok(Some(pw.clone()));
        }
        if let Some(ref path) = self.password_file {
            let content = std::fs::read_to_string(path)
                .map_err(|e| format!("Failed to read password file {}: {e}", path.display()))?;
            return Ok(Some(content.trim().to_string()));
        }
        Err(
            "No password set. Use --password, FILEHELPER_PASSWORD, --password-file, or --no-auth."
                .to_string(),
        )
    }

    pub fn parse_session_ttl_secs(&self) -> Result<u64, String> {
        parse_duration(&self.session_ttl)
    }
}

fn parse_duration(s: &str) -> Result<u64, String> {
    let s = s.trim();
    if s.ends_with('d') {
        let days: u64 = s[..s.len() - 1]
            .parse()
            .map_err(|_| format!("Invalid duration: {s}"))?;
        Ok(days * 86400)
    } else if s.ends_with('h') {
        let hours: u64 = s[..s.len() - 1]
            .parse()
            .map_err(|_| format!("Invalid duration: {s}"))?;
        Ok(hours * 3600)
    } else if s.ends_with('m') {
        let mins: u64 = s[..s.len() - 1]
            .parse()
            .map_err(|_| format!("Invalid duration: {s}"))?;
        Ok(mins * 60)
    } else if s.ends_with('s') {
        s[..s.len() - 1]
            .parse()
            .map_err(|_| format!("Invalid duration: {s}"))
    } else {
        s.parse().map_err(|_| format!("Invalid duration: {s}"))
    }
}