use crate::config::{AEAD_TAG, CREATE_LIMIT, CREATE_WINDOW_SECS, FILE_CHUNK_SIZE};
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
    /// Per-space realtime fan-out (Space A never sees Space B events).
    pub spaces: Arc<SpaceBroker>,
    /// Login failure limiter (5 / 60s / IP).
    pub login_limiter: Arc<RateLimiter>,
    /// Space creation limiter (10 / 60s / IP).
    pub create_limiter: Arc<RateLimiter>,
    /// In-memory sequential upload registry.
    pub uploads: Arc<crate::files::upload::UploadRegistry>,
}

#[derive(Clone)]
pub struct AppConfig {
    pub name: String,
    pub max_upload_size: u64,
    /// Hard cap on total ciphertext for one upload: max plaintext plus
    /// the worst-case AEAD overhead for fixed 8 MiB chunks.
    pub max_ciphertext_size: u64,
    pub data_dir: PathBuf,
    pub files_dir: PathBuf,
    pub tmp_dir: PathBuf,
    pub trash_dir: PathBuf,
    /// HMAC-SHA256 key that signs Bearer session tokens. Persisted in
    /// data_dir/session-secret (0600) in persistent mode; in-memory under
    /// --ephemeral.
    pub session_secret: [u8; 32],
    pub instance_id: String,
    pub crypto_version: u32,
    pub ephemeral: bool,
}

/// One realtime event, tagged with the space it belongs to.
#[derive(Clone, Debug, serde::Serialize)]
pub struct SpaceEvent {
    pub space_id: String,
    pub event: serde_json::Value,
}

/// Registry of per-space broadcast channels. Channels are created lazily
/// on first subscribe; empty channels are dropped when the last receiver
/// goes away (broadcast::Sender stays, receivers are refcounted — we
/// prune senders that have no receivers on publish).
pub struct SpaceBroker {
    inner: Mutex<HashMap<String, broadcast::Sender<SpaceEvent>>>,
}

impl Default for SpaceBroker {
    fn default() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }
}

impl SpaceBroker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Subscribe to a space's channel, creating it if needed.
    pub fn subscribe(&self, space_id: &str) -> broadcast::Receiver<SpaceEvent> {
        let mut map = self.inner.lock().unwrap();
        let sender = map
            .entry(space_id.to_string())
            .or_insert_with(|| broadcast::channel(256).0);
        sender.subscribe()
    }

    /// Publish an event to a space. Drops the channel when no receiver
    /// is left (avoids unbounded growth of dead channels).
    pub fn publish(&self, space_id: &str, event: serde_json::Value) {
        let mut map = self.inner.lock().unwrap();
        if let Some(sender) = map.get(space_id) {
            if sender.receiver_count() == 0 {
                map.remove(space_id);
                return;
            }
            let _ = sender.send(SpaceEvent {
                space_id: space_id.to_string(),
                event,
            });
        }
    }
}

// Simple in-memory per-IP failure limiter. Single process only.
#[derive(Default)]
pub struct RateLimiter {
    window: Duration,
    max: usize,
    inner: Mutex<HashMap<IpAddr, Vec<Instant>>>,
}

impl RateLimiter {
    pub fn login() -> Self {
        Self {
            window: Duration::from_secs(60),
            max: 5,
            inner: Mutex::new(HashMap::new()),
        }
    }

    pub fn create() -> Self {
        Self {
            window: Duration::from_secs(CREATE_WINDOW_SECS),
            max: CREATE_LIMIT,
            inner: Mutex::new(HashMap::new()),
        }
    }

    pub fn check(&self, ip: &IpAddr) -> Result<(), AppError> {
        let mut map = self.inner.lock().unwrap();
        let now = Instant::now();
        map.retain(|_, failures| {
            failures.retain(|t| now.duration_since(*t) < self.window);
            !failures.is_empty()
        });
        if map.get(ip).map(|v| v.len()).unwrap_or(0) >= self.max {
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
        Self {
            db,
            config: Arc::new(config),
            spaces: Arc::new(SpaceBroker::new()),
            login_limiter: Arc::new(RateLimiter::login()),
            create_limiter: Arc::new(RateLimiter::create()),
            uploads: Arc::new(crate::files::upload::UploadRegistry::default()),
        }
    }

    pub fn max_ciphertext_size(&self) -> u64 {
        self.config.max_ciphertext_size
    }
}

/// Compute the ciphertext cap for a configured plaintext max upload:
/// every chunk carries a 16-byte AEAD tag and the last partial chunk may
/// be any size, so overhead <= chunk_count * tag + slack.
pub fn ciphertext_cap(max_upload_size: u64) -> u64 {
    let chunks = max_upload_size.div_ceil(FILE_CHUNK_SIZE).max(1);
    max_upload_size + chunks * AEAD_TAG + 4096
}
