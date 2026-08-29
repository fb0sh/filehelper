#![allow(dead_code)]
use filehelper::app::App;
use filehelper::auth::session;
use filehelper::config::Config;
use filehelper::state::{AppConfig, AppState};
use sqlx::sqlite::SqlitePoolOptions;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// DB-level setup (integration tests that don't need the router)
// ---------------------------------------------------------------------------

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

    filehelper::db::init_db(&pool).await.unwrap();

    let config = AppConfig {
        name: "FileHelper Test".to_string(),
        max_upload_size: 10 * 1024 * 1024,
        data_dir: tmp.clone(),
        files_dir: tmp.join("files"),
        tmp_dir: tmp.join("tmp"),
        trash_dir: tmp.join("trash"),
        signing_key: [7u8; 32],
        runtime_code: None,
        ephemeral: false,
    };

    let state = AppState::new(pool, config);
    (state, tmp)
}

pub fn cleanup(dir: &PathBuf) {
    let _ = std::fs::remove_dir_all(dir);
}

// ---------------------------------------------------------------------------
// Full-app setup (auth/lifecycle tests)
// ---------------------------------------------------------------------------

pub fn app_config(data_dir: PathBuf) -> Config {
    Config {
        addr: "127.0.0.1:0".to_string(),
        password: None,
        data_dir: Some(data_dir),
        ephemeral: false,
        reset_code: false,
        max_upload_size: 10 * 1024 * 1024,
    }
}

pub fn temp_dir(name: &str) -> PathBuf {
    // Unique per call even under parallel test execution.
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let rand: u64 = rand::random();
    let tmp = std::env::temp_dir().join(format!("{name}-{seq}-{rand:016x}"));
    let _ = std::fs::remove_dir_all(&tmp);
    tmp
}

// ---------------------------------------------------------------------------
// Session cookie helpers
// ---------------------------------------------------------------------------

pub fn make_session_cookie(state: &AppState) -> String {
    session::issue_session_cookie(&state.config.signing_key, 3600, false).unwrap()
}

// "filehelper_session=<token>" value for the Cookie request header.
pub fn session_cookie_header(state: &AppState) -> String {
    let cookie = make_session_cookie(state);
    cookie.split(';').next().unwrap_or("").to_string()
}

pub fn test_router(state: AppState) -> axum::Router {
    filehelper::routes::build_router(state)
}

// ---------------------------------------------------------------------------
// Multipart helpers shared by router tests
// ---------------------------------------------------------------------------

pub const BOUNDARY: &str = "----filehelpertest";

pub fn multipart_body(parts: &[String]) -> axum::body::Body {
    let mut body = String::new();
    for part in parts {
        body.push_str(&format!("--{BOUNDARY}\r\n{part}\r\n"));
    }
    body.push_str(&format!("--{BOUNDARY}--\r\n"));
    axum::body::Body::from(body)
}

pub fn file_part(filename: &str, content: &str) -> String {
    format!(
        "Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: text/plain\r\n\r\n{content}"
    )
}

pub fn multipart_request(
    uri: &str,
    body: axum::body::Body,
    cookie: &str,
) -> axum::http::Request<axum::body::Body> {
    axum::http::Request::builder()
        .method("POST")
        .uri(uri)
        .header(
            "content-type",
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .header("cookie", cookie)
        .header("x-filehelper-request", "1")
        .body(body)
        .unwrap()
}

pub async fn json_request(
    app: &App,
    method: &str,
    uri: &str,
    cookie: Option<&str>,
    json: &str,
) -> axum::response::Response {
    use tower::ServiceExt;
    let mut builder = axum::http::Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .header("x-filehelper-request", "1");
    if let Some(c) = cookie {
        builder = builder.header("cookie", c);
    }
    app.router()
        .oneshot(
            builder
                .body(axum::body::Body::from(json.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}

pub async fn login(app: &App, code: &str) -> axum::response::Response {
    json_request(
        app,
        "POST",
        "/api/v1/auth/login",
        None,
        &format!("{{\"code\":\"{code}\"}}"),
    )
    .await
}

pub fn cookie_from_response(res: &axum::response::Response) -> String {
    res.headers()
        .get("set-cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string()
}

pub async fn read_body(res: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(res.into_body(), 10 * 1024 * 1024)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[allow(dead_code)]
pub fn assert_file_exists(dir: &Path, storage_name: &str) {
    assert!(
        dir.join(storage_name).exists(),
        "missing file {storage_name}"
    );
}
