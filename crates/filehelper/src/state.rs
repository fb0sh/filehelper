#![allow(dead_code)]
use crate::error::AppError;
use std::collections::HashMap;
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub config: Arc<AppConfig>,
    pub broadcast: broadcast::Sender<BroadcastEvent>,
    pub rate_limiter: Arc<RateLimiter>,
}

#[derive(Clone)]
pub struct AppConfig {
    pub name: String,
    pub max_upload_size: u64,
    pub data_dir: PathBuf,
    pub files_dir: PathBuf,
    pub tmp_dir: PathBuf,
    pub trash_dir: PathBuf,
    /// HMAC-SHA256 key used to sign session cookies.
    pub signing_key: [u8; 32],
    /// Literal access code for this process only (--password override).
    /// When set, verification uses a constant-time comparison instead of
    /// the persisted Argon2id hash, and nothing is persisted.
    pub runtime_code: Option<String>,
    pub ephemeral: bool,
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

// Simple in-memory per-IP login failure limiter. Single process only.
#[derive(Default)]
pub struct RateLimiter {
    inner: Mutex<HashMap<IpAddr, Vec<Instant>>>,
}

impl RateLimiter {
    const WINDOW: Duration = Duration::from_secs(60);
    const MAX_FAILURES: usize = 5;

    pub fn check(&self, ip: &IpAddr) -> Result<(), AppError> {
        let mut map = self.inner.lock().unwrap();
        let now = Instant::now();
        // Prune expired entries while we're here.
        map.retain(|_, failures| {
            failures.retain(|t| now.duration_since(*t) < Self::WINDOW);
            !failures.is_empty()
        });
        if map.get(ip).map(|v| v.len()).unwrap_or(0) >= Self::MAX_FAILURES {
            return Err(AppError::RateLimited);
        }
        Ok(())
    }

    pub fn record_failure(&self, ip: &IpAddr) {
        self.inner
            .lock()
            .unwrap()
            .entry(*ip)
            .or_default()
            .push(Instant::now());
    }

    pub fn clear(&self, ip: &IpAddr) {
        self.inner.lock().unwrap().remove(ip);
    }
}

impl AppState {
    pub fn new(db: sqlx::SqlitePool, config: AppConfig) -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            db,
            config: Arc::new(config),
            broadcast: tx,
            rate_limiter: Arc::new(RateLimiter::default()),
        }
    }
}
