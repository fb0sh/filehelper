#![allow(dead_code)]
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use filehelper::app::App;
use filehelper::config::Config;
use filehelper::state::AppState;
use std::path::PathBuf;

pub fn temp_dir(name: &str) -> PathBuf {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let rand: u64 = rand::random();
    let tmp = std::env::temp_dir().join(format!("{name}-{seq}-{rand:016x}"));
    let _ = std::fs::remove_dir_all(&tmp);
    tmp
}

pub fn app_config(data_dir: PathBuf) -> Config {
    Config {
        addr: "127.0.0.1:0".to_string(),
        data_dir: Some(data_dir),
        ephemeral: false,
        max_upload_size: 64 * 1024 * 1024,
        no_tls: true, // tests never serve TLS
    }
}

pub async fn start_app(data_dir: PathBuf) -> App {
    App::start(&app_config(data_dir)).await.unwrap()
}

pub fn cleanup(dir: &PathBuf) {
    let _ = std::fs::remove_dir_all(dir);
}

// ---------------------------------------------------------------------------
// Auth helpers: a fake 32-byte auth key (base64url) and space lifecycle
// ---------------------------------------------------------------------------

pub fn auth_key_b64() -> String {
    let bytes: [u8; 32] = rand::random();
    URL_SAFE_NO_PAD.encode(bytes)
}

/// POST /auth/create then /auth/login. Returns the Bearer token.
pub async fn create_and_login(app: &App, space_id: &str, auth_key: &str) -> String {
    let create = json_request(
        app,
        "POST",
        "/api/v1/auth/create",
        None,
        &format!("{{\"spaceId\":\"{space_id}\",\"authKey\":\"{auth_key}\"}}"),
    )
    .await;
    assert!(
        create.status().is_success(),
        "create failed: {:?}",
        read_body(create).await
    );
    login(app, space_id, auth_key).await
}

pub async fn login(app: &App, space_id: &str, auth_key: &str) -> String {
    let res = json_request(
        app,
        "POST",
        "/api/v1/auth/login",
        None,
        &format!("{{\"spaceId\":\"{space_id}\",\"authKey\":\"{auth_key}\"}}"),
    )
    .await;
    assert!(
        res.status().is_success(),
        "login failed: {:?}",
        read_body(res).await
    );
    let v = read_body(res).await;
    v["sessionToken"].as_str().unwrap().to_string()
}

// ---------------------------------------------------------------------------
// HTTP helpers (Bearer auth, JSON bodies)
// ---------------------------------------------------------------------------

pub async fn json_request(
    app: &App,
    method: &str,
    uri: &str,
    token: Option<&str>,
    json: &str,
) -> axum::response::Response {
    use tower::ServiceExt;
    let mut builder = axum::http::Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .header("x-filehelper-request", "1");
    if let Some(t) = token {
        builder = builder.header("authorization", format!("Bearer {t}"));
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

pub async fn raw_request(
    app: &App,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: axum::body::Body,
    content_type: &str,
) -> axum::response::Response {
    use tower::ServiceExt;
    let mut builder = axum::http::Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", content_type)
        .header("x-filehelper-request", "1");
    if let Some(t) = token {
        builder = builder.header("authorization", format!("Bearer {t}"));
    }
    app.router()
        .oneshot(builder.body(body).unwrap())
        .await
        .unwrap()
}

pub async fn read_body(res: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(res.into_body(), 16 * 1024 * 1024)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

pub async fn read_bytes(res: axum::response::Response) -> Vec<u8> {
    axum::body::to_bytes(res.into_body(), 64 * 1024 * 1024)
        .await
        .unwrap()
        .to_vec()
}

pub async fn assert_json_error(res: axum::response::Response, code: &str) -> u16 {
    let status = res.status().as_u16();
    let body = read_body(res).await;
    assert_eq!(body["error"]["code"], code, "unexpected error: {body}");
    status
}

// ---------------------------------------------------------------------------
// Upload flow helper: init → chunk(s) → complete
// ---------------------------------------------------------------------------

pub struct UploadResult {
    pub message_id: String,
    pub attachment_id: String,
    pub download_url: String,
}

pub async fn upload_file(
    app: &App,
    token: &str,
    payload: &str,
    ciphertext: &[u8],
    chunk_size: usize,
) -> UploadResult {
    // init
    let init = json_request(app, "POST", "/api/v1/uploads", Some(token), "{}").await;
    assert!(
        init.status().is_success(),
        "init failed: {:?}",
        read_body(init).await
    );
    let init_v = read_body(init).await;
    let upload_id = init_v["uploadId"].as_str().unwrap().to_string();
    let attachment_id = init_v["attachmentId"].as_str().unwrap().to_string();

    // chunks
    let mut offset = 0usize;
    let mut index = 0u64;
    while offset < ciphertext.len() {
        let end = (offset + chunk_size).min(ciphertext.len());
        let chunk = &ciphertext[offset..end];
        let res = raw_request(
            app,
            "PUT",
            &format!("/api/v1/uploads/{upload_id}/chunks/{index}"),
            Some(token),
            axum::body::Body::from(chunk.to_vec()),
            "application/octet-stream",
        )
        .await;
        assert!(
            res.status().is_success(),
            "chunk {index} failed: {:?}",
            read_body(res).await
        );
        offset = end;
        index += 1;
    }

    // complete
    let complete = json_request(
        app,
        "POST",
        &format!("/api/v1/uploads/{upload_id}/complete"),
        Some(token),
        &format!(
            "{{\"payload\":{}}}",
            serde_json::to_string(payload).unwrap()
        ),
    )
    .await;
    assert!(
        complete.status().is_success(),
        "complete failed: {:?}",
        read_body(complete).await
    );
    let v = read_body(complete).await;
    UploadResult {
        message_id: v["id"].as_str().unwrap().to_string(),
        attachment_id,
        download_url: v["attachment"]["downloadUrl"].as_str().unwrap().to_string(),
    }
}

pub async fn send_text(app: &App, token: &str, payload: &str) -> serde_json::Value {
    let res = json_request(
        app,
        "POST",
        "/api/v1/messages",
        Some(token),
        &format!(
            "{{\"payload\":{}}}",
            serde_json::to_string(payload).unwrap()
        ),
    )
    .await;
    assert!(
        res.status().is_success(),
        "send failed: {:?}",
        read_body(res).await
    );
    read_body(res).await
}

pub async fn list_messages(app: &App, token: &str) -> serde_json::Value {
    let res = json_request(app, "GET", "/api/v1/messages", Some(token), "").await;
    read_body(res).await
}

pub fn state_of(app: &App) -> AppState {
    app.state()
}
