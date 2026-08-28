#![allow(dead_code)]
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub config: Arc<AppConfig>,
    pub broadcast: broadcast::Sender<BroadcastEvent>,
}

#[derive(Clone)]
pub struct AppConfig {
    pub name: String,
    pub max_upload_size: u64,
    pub data_dir: PathBuf,
    pub files_dir: PathBuf,
    pub tmp_dir: PathBuf,
    pub trash_dir: PathBuf,
    pub auth_enabled: bool,
    pub session_ttl_secs: u64,
    pub auth_salt: [u8; 32],
    pub session_key: [u8; 32],
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct BroadcastEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "messageId")]
    pub message_id: Option<String>,
}

impl AppState {
    pub fn new(db: SqlitePool, config: AppConfig) -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            db,
            config: Arc::new(config),
            broadcast: tx,
        }
    }
}
