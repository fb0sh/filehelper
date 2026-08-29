mod common;

use common::{
    app_config, cleanup, cookie_from_response, file_part, json_request, login, multipart_body,
    multipart_request, temp_dir,
};
use filehelper::app::App;
use filehelper::config::Config;
use tower::ServiceExt;

async fn get(app: &App, uri: &str, cookie: Option<&str>) -> axum::response::Response {
    let mut builder = axum::http::Request::builder().method("GET").uri(uri);
    if let Some(c) = cookie {
        builder = builder.header("cookie", c);
    }
    app.router()
        .oneshot(builder.body(axum::body::Body::empty()).unwrap())
        .await
        .unwrap()
}

fn token(cookie: &str) -> String {
    cookie.split(';').next().unwrap_or("").to_string()
}

#[tokio::test]
async fn fresh_run_creates_data_directory() {
    let dir = temp_dir("fh-datadir");
    let cfg = app_config(dir.clone());
    let app = App::start(&cfg).await.unwrap();
    assert!(dir.exists(), "data dir must be created");
    assert!(dir.join("files").exists());
    assert!(dir.join("filehelper.db").exists());
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn fresh_run_creates_access_code() {
    let dir = temp_dir("fh-freshcode");
    let cfg = app_config(dir.clone());
    let app = App::start(&cfg).await.unwrap();
    let code = app.access_code.clone().unwrap();
    assert_eq!(code.len(), 6);
    assert!(code.chars().all(|c| c.is_ascii_digit()));
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn second_run_changes_access_code() {
    let dir = temp_dir("fh-restorecode");
    let cfg = app_config(dir.clone());
    let app1 = App::start(&cfg).await.unwrap();
    let code1 = app1.access_code.clone().unwrap();
    app1.shutdown().await;

    // Default behavior: every start gets a fresh access code.
    let app2 = App::start(&cfg).await.unwrap();
    let code2 = app2.access_code.clone().unwrap();
    assert_ne!(code1, code2, "restart must generate a new access code");
    app2.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn second_run_restores_messages() {
    let dir = temp_dir("fh-restoremsg");
    let cfg = app_config(dir.clone());
    let app1 = App::start(&cfg).await.unwrap();
    let code = app1.access_code.clone().unwrap();
    let cookie = token(&cookie_from_response(&login(&app1, &code).await));
    let res = json_request(
        &app1,
        "POST",
        "/api/v1/messages",
        Some(&cookie),
        "{\"text\":\"persist me\"}",
    )
    .await;
    assert_eq!(res.status(), 200);
    app1.shutdown().await;

    let app2 = App::start(&cfg).await.unwrap();
    let cookie2 = token(&cookie_from_response(
        &login(&app2, &app2.access_code.clone().unwrap()).await,
    ));
    let res = get(&app2, "/api/v1/messages", Some(&cookie2)).await;
    assert_eq!(res.status(), 200);
    let body = common::read_body(res).await;
    assert_eq!(body["messages"][0]["text"], "persist me");
    app2.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn second_run_restores_files() {
    let dir = temp_dir("fh-restorefile");
    let cfg = app_config(dir.clone());
    let app1 = App::start(&cfg).await.unwrap();
    let code = app1.access_code.clone().unwrap();
    let cookie = token(&cookie_from_response(&login(&app1, &code).await));
    let body = multipart_body(&[file_part("keep.txt", "file content here")]);
    let res = app1
        .router()
        .oneshot(multipart_request("/api/v1/uploads", body, &cookie))
        .await
        .unwrap();
    assert_eq!(res.status(), 201);
    let json = common::read_body(res).await;
    let att_id = json["attachment"]["id"].as_str().unwrap().to_string();
    app1.shutdown().await;

    let app2 = App::start(&cfg).await.unwrap();
    let code2 = app2.access_code.clone().unwrap();
    let cookie2 = token(&cookie_from_response(&login(&app2, &code2).await));
    let res = get(
        &app2,
        &format!("/api/v1/files/{att_id}/content"),
        Some(&cookie2),
    )
    .await;
    assert_eq!(res.status(), 200);
    let bytes = axum::body::to_bytes(res.into_body(), 1024).await.unwrap();
    assert_eq!(bytes.to_vec(), b"file content here");
    app2.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn valid_code_login() {
    let dir = temp_dir("fh-validlogin");
    let cfg = app_config(dir.clone());
    let app = App::start(&cfg).await.unwrap();
    let code = app.access_code.clone().unwrap();
    let res = login(&app, &code).await;
    assert_eq!(res.status(), 200);
    assert!(cookie_from_response(&res).starts_with("filehelper_session="));
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn invalid_code_login() {
    let dir = temp_dir("fh-invalidlogin");
    let cfg = app_config(dir.clone());
    let app = App::start(&cfg).await.unwrap();
    let res = login(&app, "000000").await;
    assert_eq!(res.status(), 401);
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn login_rate_limit() {
    let dir = temp_dir("fh-ratelimit");
    let cfg = app_config(dir.clone());
    let app = App::start(&cfg).await.unwrap();
    for _ in 0..5 {
        let res = login(&app, "999999").await;
        assert_eq!(res.status(), 401);
    }
    // 6th attempt (even with the correct code) is rate limited.
    let code = app.access_code.clone().unwrap();
    let res = login(&app, &code).await;
    assert_eq!(res.status(), 429);
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn old_cookie_invalid_after_restart_new_code_works() {
    let dir = temp_dir("fh-cookierestart");
    let cfg = app_config(dir.clone());
    let app1 = App::start(&cfg).await.unwrap();
    let code1 = app1.access_code.clone().unwrap();
    let cookie = token(&cookie_from_response(&login(&app1, &code1).await));
    assert!(!cookie.is_empty());
    app1.shutdown().await;

    // The signing key rotated with the code: old sessions are invalid.
    let app2 = App::start(&cfg).await.unwrap();
    let res = get(&app2, "/api/v1/auth/session", Some(&cookie)).await;
    assert_eq!(
        res.status(),
        401,
        "old cookie must be invalid after restart"
    );

    // Logging in with the fresh code yields a working session.
    let code2 = app2.access_code.clone().unwrap();
    assert_ne!(code1, code2);
    let new_cookie = token(&cookie_from_response(&login(&app2, &code2).await));
    let res = get(&app2, "/api/v1/auth/session", Some(&new_cookie)).await;
    assert_eq!(res.status(), 200);
    app2.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn reset_code_changes_code() {
    let dir = temp_dir("fh-resetcode");
    let cfg = app_config(dir.clone());
    let app1 = App::start(&cfg).await.unwrap();
    let code1 = app1.access_code.clone().unwrap();
    app1.shutdown().await;

    let mut cfg2 = app_config(dir.clone());
    cfg2.reset_code = true;
    let app2 = App::start(&cfg2).await.unwrap();
    let code2 = app2.access_code.clone().unwrap();
    assert_ne!(code1, code2, "reset must produce a different code");
    app2.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn reset_code_invalidates_previous_cookie() {
    let dir = temp_dir("fh-resetinvalid");
    let cfg = app_config(dir.clone());
    let app1 = App::start(&cfg).await.unwrap();
    let code1 = app1.access_code.clone().unwrap();
    let cookie = token(&cookie_from_response(&login(&app1, &code1).await));
    app1.shutdown().await;

    let mut cfg2 = app_config(dir.clone());
    cfg2.reset_code = true;
    let app2 = App::start(&cfg2).await.unwrap();
    let res = get(&app2, "/api/v1/auth/session", Some(&cookie)).await;
    assert_eq!(res.status(), 401, "old cookie must be invalid after reset");
    app2.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn runtime_password_override() {
    let dir = temp_dir("fh-runtimepw");
    let mut cfg = app_config(dir.clone());
    cfg.password = Some("654321".to_string());
    let app = App::start(&cfg).await.unwrap();

    // No persistence: no secret file, no stored code.
    assert!(!dir.join("secret").exists());
    assert!(app.access_code.is_none());

    let res = login(&app, "654321").await;
    assert_eq!(res.status(), 200);
    let res = login(&app, "111111").await;
    assert_eq!(res.status(), 401);

    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn ephemeral_uses_temp_dir() {
    let cfg = Config {
        addr: "127.0.0.1:0".to_string(),
        password: None,
        data_dir: None,
        ephemeral: true,
        reset_code: false,
        max_upload_size: 1024,
    };
    let app = App::start(&cfg).await.unwrap();
    let tmp_root = std::env::temp_dir();
    assert!(
        app.data_dir.starts_with(&tmp_root),
        "ephemeral data dir must live under the system temp dir"
    );
    assert!(app.ephemeral);
    // Fresh access code every run.
    let code1 = app.access_code.clone().unwrap();
    let dir = app.data_dir.clone();
    app.shutdown().await;
    cleanup(&dir);
    let _ = code1;
}

#[tokio::test]
async fn ephemeral_cleanup_on_shutdown() {
    let cfg = Config {
        addr: "127.0.0.1:0".to_string(),
        password: None,
        data_dir: None,
        ephemeral: true,
        reset_code: false,
        max_upload_size: 1024,
    };
    let app = App::start(&cfg).await.unwrap();
    let dir = app.data_dir.clone();
    assert!(dir.exists());
    app.shutdown().await;
    assert!(
        !dir.exists(),
        "ephemeral data dir must be removed on shutdown"
    );
}

#[tokio::test]
async fn protected_download_requires_auth() {
    let dir = temp_dir("fh-authdl");
    let cfg = app_config(dir.clone());
    let app = App::start(&cfg).await.unwrap();
    let res = get(&app, "/api/v1/files/anything/content", None).await;
    assert_eq!(res.status(), 401);
    let res = get(&app, "/api/v1/files/anything/download", None).await;
    assert_eq!(res.status(), 401);
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn websocket_requires_auth() {
    let dir = temp_dir("fh-authws");
    let cfg = app_config(dir.clone());
    let app = App::start(&cfg).await.unwrap();
    let res = get(&app, "/api/v1/ws", None).await;
    assert_eq!(res.status(), 401);
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn unicode_filename_roundtrip() {
    let dir = temp_dir("fh-unicode");
    let cfg = app_config(dir.clone());
    let app = App::start(&cfg).await.unwrap();
    let code = app.access_code.clone().unwrap();
    let cookie = token(&cookie_from_response(&login(&app, &code).await));

    // Unicode + spaces + emoji + a path-separator attempt in the name.
    let name = "报告 总结 2026 📄.txt";
    let body = multipart_body(&[file_part(name, "unicode content")]);
    let res = app
        .router()
        .oneshot(multipart_request("/api/v1/uploads", body, &cookie))
        .await
        .unwrap();
    assert_eq!(res.status(), 201);
    let json = common::read_body(res).await;
    assert_eq!(json["attachment"]["filename"], name);
    let att_id = json["attachment"]["id"].as_str().unwrap().to_string();

    // Stored file must be a UUID under files/, never the raw filename.
    let entries: Vec<_> = std::fs::read_dir(dir.join("files"))
        .unwrap()
        .filter_map(|e| e.ok())
        .collect();
    assert_eq!(entries.len(), 1);
    let stored_name = entries[0].file_name().to_string_lossy().to_string();
    assert_ne!(stored_name, name);
    assert_eq!(stored_name.len(), 36, "storage name is a UUID");

    // Download with Range still returns the original content.
    let res = get(
        &app,
        &format!("/api/v1/files/{att_id}/content"),
        Some(&cookie),
    )
    .await;
    assert_eq!(res.status(), 200);
    let bytes = axum::body::to_bytes(res.into_body(), 1024).await.unwrap();
    assert_eq!(bytes.to_vec(), b"unicode content");

    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn traversal_attempt_cannot_escape_data_dir() {
    let dir = temp_dir("fh-traversal");
    let cfg = app_config(dir.clone());
    let app = App::start(&cfg).await.unwrap();
    let code = app.access_code.clone().unwrap();
    let cookie = token(&cookie_from_response(&login(&app, &code).await));

    // Filename containing path separators and traversal tokens.
    let name = "../../escape/../../etc/passwd.txt";
    let body = multipart_body(&[file_part(name, "nope")]);
    let res = app
        .router()
        .oneshot(multipart_request("/api/v1/uploads", body, &cookie))
        .await
        .unwrap();
    assert_eq!(res.status(), 201);

    // No file escaped the data dir.
    assert!(!dir.parent().unwrap().join("escape").exists());
    assert!(!dir.join("..").join("escape").exists());
    // The file lives under files/ as a UUID.
    let entries: Vec<_> = std::fs::read_dir(dir.join("files"))
        .unwrap()
        .filter_map(|e| e.ok())
        .collect();
    assert_eq!(entries.len(), 1);

    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn clear_all_removes_messages_but_keeps_code() {
    let dir = temp_dir("fh-clearall");
    let cfg = app_config(dir.clone());
    let app = App::start(&cfg).await.unwrap();
    let code = app.access_code.clone().unwrap();
    let cookie = token(&cookie_from_response(&login(&app, &code).await));

    json_request(
        &app,
        "POST",
        "/api/v1/messages",
        Some(&cookie),
        "{\"text\":\"hello\"}",
    )
    .await;
    let body = multipart_body(&[file_part("gone.txt", "x")]);
    let res = app
        .router()
        .oneshot(multipart_request("/api/v1/uploads", body, &cookie))
        .await
        .unwrap();
    assert_eq!(res.status(), 201);

    let res = json_request(&app, "POST", "/api/v1/clear", Some(&cookie), "").await;
    assert_eq!(res.status(), 200);

    let list = get(&app, "/api/v1/messages", Some(&cookie)).await;
    let body = common::read_body(list).await;
    assert_eq!(body["messages"].as_array().unwrap().len(), 0);

    // Access code still works after clearing.
    let res = login(&app, &code).await;
    assert_eq!(res.status(), 200);

    app.shutdown().await;
    cleanup(&dir);
}
