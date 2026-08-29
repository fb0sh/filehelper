use crate::config::Config;
use crate::state::{AppConfig, AppState, ciphertext_cap};
use sqlx::sqlite::SqlitePoolOptions;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Fully bootstrapped FileHelper instance: data dir, database, auth,
/// router. Used by both the binary and the integration tests.
pub struct App {
    pub state: AppState,
    pub data_dir: PathBuf,
    pub ephemeral: bool,
    router: axum::Router,
}

const SESSION_SECRET_FILE: &str = "session-secret";

impl App {
    pub async fn start(config: &Config) -> Result<Self, String> {
        let data_dir = config.resolve_data_dir()?;

        // Pre-E2EE data (plaintext schema) is never auto-migrated:
        // rename the whole directory aside and start a fresh encrypted
        // store. The old files stay untouched on disk.
        let backup = maybe_backup_legacy(&data_dir).await?;
        if let Some(backup) = backup {
            println!(
                "Legacy FileHelper data was preserved at:\n  {}",
                backup.display()
            );
        }

        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
        crate::files::storage::ensure_dirs(&data_dir).map_err(|e| e.to_string())?;

        let db_path = data_dir.join("filehelper.db");
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&format!("sqlite://{}?mode=rwc", db_path.display()))
            .await
            .map_err(|e| e.to_string())?;

        crate::db::init_db(&pool).await.map_err(|e| e.to_string())?;
        let instance_id = crate::db::get_or_create_instance_id(&pool)
            .await
            .map_err(|e| e.to_string())?;

        // Session signing secret: persisted (0600) so Bearer tokens and
        // server restarts play well together. --ephemeral gets a fresh
        // in-memory secret (and a fresh temp data dir).
        let session_secret = if config.ephemeral {
            rand::random()
        } else {
            load_or_create_session_secret(&data_dir).map_err(|e| e.to_string())?
        };

        let app_config = AppConfig {
            name: "FileHelper".to_string(),
            max_upload_size: config.max_upload_size,
            max_ciphertext_size: ciphertext_cap(config.max_upload_size),
            data_dir: data_dir.clone(),
            files_dir: data_dir.join("files"),
            tmp_dir: data_dir.join("tmp"),
            trash_dir: data_dir.join("trash"),
            session_secret,
            instance_id,
            crypto_version: crate::db::CRYPTO_VERSION,
            ephemeral: config.ephemeral,
        };

        let state = AppState::new(pool, app_config);
        crate::files::gc::startup_cleanup(&state).await;
        let router = crate::routes::build_router(state.clone());

        Ok(Self {
            state,
            data_dir,
            ephemeral: config.ephemeral,
            router,
        })
    }

    pub fn router(&self) -> axum::Router {
        self.router.clone()
    }

    pub fn state(&self) -> AppState {
        self.state.clone()
    }

    /// Close the DB pool and, in ephemeral mode, remove the temp data
    /// directory (retrying so Windows has time to release file handles).
    pub async fn shutdown(self) {
        self.state.db.close().await;
        if self.ephemeral {
            let dir = self.data_dir.clone();
            tokio::task::spawn_blocking(move || remove_dir_retry(&dir))
                .await
                .ok();
        }
    }
}

/// If the data dir holds a legacy (pre-E2EE) database, rename the whole
/// directory to `legacy-backup-YYYYMMDD-HHMMSS` (atomic rename, never a
/// copy) and return its path. Fresh/encrypted dirs are untouched.
async fn maybe_backup_legacy(data_dir: &Path) -> Result<Option<PathBuf>, String> {
    if data_dir.join("filehelper.db").exists() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&format!(
                "sqlite://{}?mode=ro",
                data_dir.join("filehelper.db").display()
            ))
            .await
            .map_err(|e| e.to_string())?;
        let legacy = crate::db::detect_legacy(&pool)
            .await
            .map_err(|e| e.to_string())?;
        pool.close().await;
        if legacy {
            let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
            let backup = data_dir
                .parent()
                .unwrap_or(Path::new("."))
                .join(format!("legacy-backup-{stamp}"));
            if let Some(parent) = data_dir.parent()
                && !parent.as_os_str().is_empty()
            {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::rename(data_dir, &backup).map_err(|e| e.to_string())?;
            return Ok(Some(backup));
        }
    }
    Ok(None)
}

fn load_or_create_session_secret(data_dir: &Path) -> Result<[u8; 32], String> {
    let path = data_dir.join(SESSION_SECRET_FILE);
    if let Ok(raw) = std::fs::read(&path)
        && raw.len() == 32
    {
        let mut key = [0u8; 32];
        key.copy_from_slice(&raw);
        return Ok(key);
    }
    let key: [u8; 32] = rand::random();
    std::fs::write(&path, key).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(key)
}

fn remove_dir_retry(dir: &Path) {
    for _ in 0..20 {
        if std::fs::remove_dir_all(dir).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    tracing::warn!("Failed to remove ephemeral data dir: {}", dir.display());
}
