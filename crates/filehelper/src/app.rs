use crate::auth::AuthBundle;
use crate::config::Config;
use crate::state::{AppConfig, AppState};
use sqlx::sqlite::SqlitePoolOptions;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Fully bootstrapped FileHelper instance: data dir, database, auth,
/// router. Used by both the binary and the integration tests.
pub struct App {
    pub state: AppState,
    pub data_dir: PathBuf,
    /// Access code for terminal display (None under --password override).
    pub access_code: Option<String>,
    pub ephemeral: bool,
    router: axum::Router,
}

impl App {
    pub async fn start(config: &Config) -> Result<Self, String> {
        let data_dir = config.resolve_data_dir()?;
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
        crate::files::storage::ensure_dirs(&data_dir).map_err(|e| e.to_string())?;

        let db_path = data_dir.join("filehelper.db");
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&format!("sqlite://{}?mode=rwc", db_path.display()))
            .await
            .map_err(|e| e.to_string())?;
        crate::db::init_db(&pool).await.map_err(|e| e.to_string())?;

        let auth: AuthBundle = if config.reset_code {
            crate::auth::reset_access_code(&data_dir, &pool)
                .await
                .map_err(|e| e.to_string())?
        } else {
            crate::auth::load_or_create_auth(&data_dir, &pool, config.password.as_deref())
                .await
                .map_err(|e| e.to_string())?
        };

        let app_config = AppConfig {
            name: "FileHelper".to_string(),
            max_upload_size: config.max_upload_size,
            data_dir: data_dir.clone(),
            files_dir: data_dir.join("files"),
            tmp_dir: data_dir.join("tmp"),
            trash_dir: data_dir.join("trash"),
            signing_key: auth.signing_key,
            runtime_code: auth.runtime_code,
            ephemeral: config.ephemeral,
        };

        let state = AppState::new(pool, app_config);
        crate::files::gc::startup_cleanup(&state).await;
        let router = crate::routes::build_router(state.clone());

        Ok(Self {
            state,
            data_dir,
            access_code: auth.access_code,
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

fn remove_dir_retry(dir: &Path) {
    for _ in 0..20 {
        if std::fs::remove_dir_all(dir).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    tracing::warn!("Failed to remove ephemeral data dir: {}", dir.display());
}
