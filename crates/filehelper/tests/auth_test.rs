use filehelper::auth::session;
use std::path::PathBuf;

mod common;
use common::*;

fn auth_body(space_id: &str, auth_key: &str) -> String {
    format!("{{\"spaceId\":\"{space_id}\",\"authKey\":\"{auth_key}\"}}")
}

#[tokio::test]
async fn login_unknown_space_returns_space_not_found() {
    let dir = temp_dir("auth-unknown");
    let app = start_app(dir.clone()).await;
    let key = auth_key_b64();
    let res = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        &auth_body("space-that-does-not-exist", &key),
    )
    .await;
    assert_json_error(res, "SPACE_NOT_FOUND").await;
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn create_then_login_roundtrip() {
    let dir = temp_dir("auth-roundtrip");
    let app = start_app(dir.clone()).await;
    let key = auth_key_b64();
    let token = create_and_login(&app, "roundtrip-space", &key).await;
    assert!(!token.is_empty());
    // Protected endpoint now works.
    let res = json_request(&app, "GET", "/api/v1/messages", Some(&token), "").await;
    assert!(res.status().is_success());
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn wrong_auth_key_fails_login() {
    let dir = temp_dir("auth-wrongkey");
    let app = start_app(dir.clone()).await;
    let key = auth_key_b64();
    create_and_login(&app, "keyed-space", &key).await;

    let wrong = auth_key_b64();
    let res = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        &auth_body("keyed-space", &wrong),
    )
    .await;
    assert_json_error(res, "AUTH_FAILED").await;
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn create_duplicate_returns_space_exists() {
    let dir = temp_dir("auth-dup");
    let app = start_app(dir.clone()).await;
    let key = auth_key_b64();
    create_and_login(&app, "dup-space", &key).await;
    let res = json_request(
        &app,
        "POST",
        "/api/v1/auth/create",
        None,
        &auth_body("dup-space", &key),
    )
    .await;
    assert_json_error(res, "SPACE_EXISTS").await;
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn login_rate_limited_after_five_failures() {
    let dir = temp_dir("auth-ratelimit");
    let app = start_app(dir.clone()).await;
    let key = auth_key_b64();
    for _ in 0..5 {
        let res = json_request(
            &app,
            "POST",
            "/api/v1/auth/login",
            None,
            &auth_body("no-such-space", &key),
        )
        .await;
        assert_json_error(res, "SPACE_NOT_FOUND").await;
    }
    // Sixth attempt in the same window is rate limited.
    let res = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        &auth_body("no-such-space", &key),
    )
    .await;
    assert_json_error(res, "RATE_LIMITED").await;
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn create_rate_limited() {
    let dir = temp_dir("auth-createlimit");
    let app = start_app(dir.clone()).await;
    let key = auth_key_b64();
    // The limiter allows 10 creates/min; one will be a duplicate, so 10
    // unique creates pass and the 11th unique create is limited.
    for i in 0..10 {
        let res = json_request(
            &app,
            "POST",
            "/api/v1/auth/create",
            None,
            &auth_body(&format!("space-{i}"), &key),
        )
        .await;
        assert!(res.status().is_success(), "create {i} failed");
    }
    let res = json_request(
        &app,
        "POST",
        "/api/v1/auth/create",
        None,
        &auth_body("space-extra", &key),
    )
    .await;
    assert_json_error(res, "RATE_LIMITED").await;
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn protected_routes_require_bearer() {
    let dir = temp_dir("auth-protected");
    let app = start_app(dir.clone()).await;
    let key = auth_key_b64();
    create_and_login(&app, "prot-space", &key).await;

    // No token → 401.
    let res = json_request(&app, "GET", "/api/v1/messages", None, "").await;
    assert_eq!(res.status().as_u16(), 401);

    // Garbage token → 401.
    let res = json_request(
        &app,
        "GET",
        "/api/v1/messages",
        Some("not.a.valid.token"),
        "",
    )
    .await;
    assert_eq!(res.status().as_u16(), 401);
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn mutation_without_x_header_rejected() {
    let dir = temp_dir("auth-xheader");
    let app = start_app(dir.clone()).await;
    let key = auth_key_b64();
    let token = create_and_login(&app, "xh-space", &key).await;

    // Send a POST without X-FileHelper-Request: 1 (defense in depth).
    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/messages")
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(axum::body::Body::from(r#"{"payload":"x"}"#))
        .unwrap();
    use tower::ServiceExt;
    let res = app.router().oneshot(req).await.unwrap();
    assert_eq!(res.status().as_u16(), 401);
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn session_token_tamper_and_expiry() {
    let dir = temp_dir("auth-tamper");
    let app = start_app(dir.clone()).await;
    let secret = app.state().config.session_secret;
    let token = session::issue_session_token(&secret, "some-space", 3600).unwrap();
    assert!(session::verify_session_token(&secret, &token).is_ok());

    // Flip one payload character → signature mismatch.
    let (payload, sig) = token.split_once('.').unwrap();
    let mut bytes =
        base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, payload).unwrap();
    bytes[0] ^= 0x01;
    let tampered_payload =
        base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, bytes);
    let tampered = format!("{tampered_payload}.{sig}");
    assert!(session::verify_session_token(&secret, &tampered).is_err());

    // Expired token → SESSION_EXPIRED. Issue with a 1s TTL and wait it
    // out so the expiry check actually triggers.
    let expired = session::issue_session_token(&secret, "some-space", 1).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(2100));
    let err = session::verify_session_token(&secret, &expired).unwrap_err();
    assert!(matches!(err, filehelper::error::AppError::SessionExpired));
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn instance_id_stable_across_restart() {
    let dir = temp_dir("auth-instance");
    let app1 = start_app(dir.clone()).await;
    let id1 = app1.state().config.instance_id.clone();
    assert_eq!(id1.len(), 43); // 32 bytes → base64url no pad
    app1.shutdown().await;

    let app2 = start_app(dir.clone()).await;
    let id2 = app2.state().config.instance_id.clone();
    assert_eq!(id1, id2, "instance id must persist across restarts");
    app2.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn ephemeral_uses_fresh_instance_id_and_cleans_up() {
    let dir = temp_dir("auth-ephemeral");
    let mut config = app_config(dir.clone());
    config.ephemeral = true;
    let app = filehelper::app::App::start(&config).await.unwrap();
    // Ephemeral resolves its own temp dir, not `dir`.
    assert_ne!(app.data_dir, dir);
    let ephemeral_dir = app.data_dir.clone();
    let _id = app.state().config.instance_id.clone();
    app.shutdown().await;
    assert!(!ephemeral_dir.exists(), "ephemeral dir must be removed");
    cleanup(&dir);
}

#[tokio::test]
async fn legacy_database_is_backed_up_and_fresh_schema_created() {
    let dir = temp_dir("auth-legacy");
    std::fs::create_dir_all(dir.join("files")).unwrap();
    std::fs::create_dir_all(dir.join("tmp")).unwrap();
    std::fs::create_dir_all(dir.join("trash")).unwrap();

    // Craft a legacy plaintext DB by hand.
    let db_path = dir.join("filehelper.db");
    let url = format!("sqlite://{}?mode=rwc", db_path.display());
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .unwrap();
    sqlx::query("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO meta VALUES ('access_code_hash', 'legacy-hash'), ('fts_schema_version', '2')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "CREATE TABLE messages (id TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT, created_at_ms INTEGER NOT NULL)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO messages VALUES ('legacy-1', 'text', 'OLD PLAINTEXT HISTORY', 1)")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;

    // Start the app: the legacy dir is renamed aside; the fresh store is
    // created in `dir` and must not contain the old plaintext history.
    let app = start_app(dir.clone()).await;
    let fresh_db = std::fs::read(dir.join("filehelper.db")).unwrap();
    assert!(
        !String::from_utf8_lossy(&fresh_db).contains("OLD PLAINTEXT HISTORY"),
        "fresh store must not inherit legacy plaintext"
    );
    // The newest legacy backup (this test's) still has the plaintext.
    let parent = dir.parent().unwrap();
    let mut backups: Vec<PathBuf> = std::fs::read_dir(parent)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .map(|n| n.to_string_lossy().starts_with("legacy-backup-"))
                .unwrap_or(false)
        })
        .collect();
    backups.sort_by_key(|b| std::fs::metadata(b).and_then(|m| m.modified()).ok());
    let newest = backups.last().expect("a legacy backup must exist");
    let backup_db = newest.join("filehelper.db");
    assert!(backup_db.exists());
    let db_bytes = std::fs::read(&backup_db).unwrap();
    let text = String::from_utf8_lossy(&db_bytes);
    assert!(
        text.contains("OLD PLAINTEXT HISTORY"),
        "backup must keep the legacy data"
    );

    // Fresh store works.
    let key = auth_key_b64();
    let token = create_and_login(&app, "fresh-space", &key).await;
    assert!(!token.is_empty());
    app.shutdown().await;
    cleanup(&dir);
    cleanup(newest);
}

#[tokio::test]
async fn per_space_tokens_are_isolated() {
    let dir = temp_dir("auth-iso");
    let app = start_app(dir.clone()).await;
    let key_a = auth_key_b64();
    let key_b = auth_key_b64();
    let token_a = create_and_login(&app, "space-a", &key_a).await;
    let token_b = create_and_login(&app, "space-b", &key_b).await;

    // A's token only sees A's space.
    send_text(&app, &token_a, "FH1.aaaa").await;
    send_text(&app, &token_b, "FH1.bbbb").await;

    let list_a = list_messages(&app, &token_a).await;
    assert_eq!(list_a["messages"].as_array().unwrap().len(), 1);
    assert_eq!(list_a["messages"][0]["payload"], "FH1.aaaa");

    let list_b = list_messages(&app, &token_b).await;
    assert_eq!(list_b["messages"].as_array().unwrap().len(), 1);
    assert_eq!(list_b["messages"][0]["payload"], "FH1.bbbb");

    // A cannot touch B's message id.
    let b_id = list_b["messages"][0]["id"].as_str().unwrap();
    let res = json_request(
        &app,
        "DELETE",
        &format!("/api/v1/messages/{b_id}"),
        Some(&token_a),
        "",
    )
    .await;
    assert_eq!(res.status().as_u16(), 204); // treated as absent, no info leak
    let list_b_after = list_messages(&app, &token_b).await;
    assert_eq!(list_b_after["messages"].as_array().unwrap().len(), 1);

    app.shutdown().await;
    cleanup(&dir);
}
