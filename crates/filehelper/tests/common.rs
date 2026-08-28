use filehelper::auth::password;
use filehelper::db;
use filehelper::state::{AppConfig, AppState};
use sqlx::sqlite::SqlitePoolOptions;
use std::path::PathBuf;

pub async fn setup_test_app() -> (AppState, PathBuf) {
    let tmp = std::env::temp_dir().join(format!("filehelper-test-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&tmp).unwrap();
    std::fs::create_dir_all(tmp.join("files")).unwrap();
    std::fs::create_dir_all(tmp.join("tmp")).unwrap();
    std::fs::create_dir_all(tmp.join("trash")).unwrap();

    let db_path = tmp.join("test.db");
    let db_url = format!("sqlite://{}?mode=rwc", db_path.display());
    let pool = SqlitePoolOptions::new()
        .max_connections(2)
        .connect(&db_url)
        .await
        .unwrap();

    db::init_db(&pool).await.unwrap();

    let password = "test123";
    let salt: [u8; 32] = rand::random();
    let (_auth_key, session_key) = password::derive_keys(password, &salt);
    let hash = password::hash_password(password).unwrap();
    sqlx::query("INSERT INTO meta (key, value) VALUES ('password_hash', ?1)")
        .bind(&hash)
        .execute(&pool)
        .await
        .unwrap();

    let config = AppConfig {
        name: "FileHelper Test".to_string(),
        max_upload_size: 10 * 1024 * 1024,
        data_dir: tmp.clone(),
        files_dir: tmp.join("files"),
        tmp_dir: tmp.join("tmp"),
        trash_dir: tmp.join("trash"),
        auth_enabled: true,
        session_ttl_secs: 3600,
        auth_salt: salt,
        session_key,
    };

    let state = AppState::new(pool, config);
    (state, tmp)
}

pub fn cleanup(dir: &PathBuf) {
    let _ = std::fs::remove_dir_all(dir);
}

pub fn make_session_cookie(state: &AppState) -> String {
    filehelper::auth::session::create_session_cookie(state).unwrap()
}