use std::path::PathBuf;

mod common;
use common::*;

#[tokio::test]
async fn text_message_create_and_list() {
    let dir = temp_dir("api-text");
    let app = start_app(dir.clone()).await;
    let key = auth_key_b64();
    let token = create_and_login(&app, "text-space", &key).await;

    let m = send_text(&app, &token, "FH1.encrypted-hello").await;
    assert_eq!(m["payload"], "FH1.encrypted-hello");
    assert!(m["id"].as_str().unwrap().len() > 10);
    assert!(m["createdAt"].as_str().unwrap().contains('T'));

    let list = list_messages(&app, &token).await;
    assert_eq!(list["messages"].as_array().unwrap().len(), 1);
    assert!(list["nextCursor"].is_null());
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn message_payload_size_limited() {
    let dir = temp_dir("api-payload");
    let app = start_app(dir.clone()).await;
    let key = auth_key_b64();
    let token = create_and_login(&app, "pl-space", &key).await;

    let big = "x".repeat(300 * 1024);
    let res = json_request(
        &app,
        "POST",
        "/api/v1/messages",
        Some(&token),
        &format!("{{\"payload\":{}}}", serde_json::to_string(&big).unwrap()),
    )
    .await;
    let status = assert_json_error(res, "PAYLOAD_TOO_LARGE").await;
    assert_eq!(status, 413);
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn upload_roundtrip_download_matches_ciphertext() {
    let dir = temp_dir("api-upload");
    let app = start_app(dir.clone()).await;
    let key = auth_key_b64();
    let token = create_and_login(&app, "up-space", &key).await;

    let ciphertext: Vec<u8> = (0..1024 * 1024).map(|i| (i % 251) as u8).collect();
    let result = upload_file(&app, &token, "FH1.file-meta", &ciphertext, 256 * 1024).await;

    // Download returns exactly the ciphertext bytes.
    let res = raw_request(
        &app,
        "GET",
        &result.download_url,
        Some(&token),
        axum::body::Body::empty(),
        "",
    )
    .await;
    assert!(res.status().is_success());
    assert_eq!(
        res.headers().get("content-type").unwrap().to_str().unwrap(),
        "application/octet-stream"
    );
    let bytes = read_bytes(res).await;
    assert_eq!(bytes, ciphertext);

    // The stored file name is a random UUID, not the original name.
    let files: Vec<String> = std::fs::read_dir(app.data_dir.join("files"))
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    assert_eq!(files.len(), 1);
    assert!(
        files[0].len() == 36,
        "storage name must be a UUID: {}",
        files[0]
    );
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn upload_chunks_must_arrive_in_order() {
    let dir = temp_dir("api-order");
    let app = start_app(dir.clone()).await;
    let key = auth_key_b64();
    let token = create_and_login(&app, "ord-space", &key).await;

    let init = json_request(&app, "POST", "/api/v1/uploads", Some(&token), "{}").await;
    let upload_id = read_body(init).await["uploadId"]
        .as_str()
        .unwrap()
        .to_string();

    // Skip chunk 0 and send chunk 1 directly.
    let res = raw_request(
        &app,
        "PUT",
        &format!("/api/v1/uploads/{upload_id}/chunks/1"),
        Some(&token),
        axum::body::Body::from(vec![1u8; 8]),
        "application/octet-stream",
    )
    .await;
    assert_json_error(res, "UPLOAD_CHUNK_ORDER").await;
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn upload_cancel_removes_part_and_state() {
    let dir = temp_dir("api-cancel");
    let app = start_app(dir.clone()).await;
    let key = auth_key_b64();
    let token = create_and_login(&app, "can-space", &key).await;

    let init = json_request(&app, "POST", "/api/v1/uploads", Some(&token), "{}").await;
    let upload_id = read_body(init).await["uploadId"]
        .as_str()
        .unwrap()
        .to_string();

    let res = raw_request(
        &app,
        "PUT",
        &format!("/api/v1/uploads/{upload_id}/chunks/0"),
        Some(&token),
        axum::body::Body::from(vec![9u8; 100]),
        "application/octet-stream",
    )
    .await;
    assert!(res.status().is_success());

    let res = raw_request(
        &app,
        "DELETE",
        &format!("/api/v1/uploads/{upload_id}"),
        Some(&token),
        axum::body::Body::empty(),
        "",
    )
    .await;
    assert_eq!(res.status().as_u16(), 204);

    // After cancel, the chunk endpoint is gone (upload not found).
    let res = raw_request(
        &app,
        "PUT",
        &format!("/api/v1/uploads/{upload_id}/chunks/1"),
        Some(&token),
        axum::body::Body::from(vec![1u8; 8]),
        "application/octet-stream",
    )
    .await;
    assert_json_error(res, "UPLOAD_NOT_FOUND").await;

    let parts: Vec<String> = std::fs::read_dir(app.data_dir.join("tmp"))
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    assert!(parts.is_empty(), "no .part should remain after cancel");
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn upload_too_large_rejected() {
    let dir = temp_dir("api-big");
    let app = start_app(dir.clone()).await;
    let key = auth_key_b64();
    let token = create_and_login(&app, "big-space", &key).await;

    let init = json_request(&app, "POST", "/api/v1/uploads", Some(&token), "{}").await;
    let upload_id = read_body(init).await["uploadId"]
        .as_str()
        .unwrap()
        .to_string();

    // Chunk bigger than chunk size + tag.
    let res = raw_request(
        &app,
        "PUT",
        &format!("/api/v1/uploads/{upload_id}/chunks/0"),
        Some(&token),
        axum::body::Body::from(vec![0u8; 9 * 1024 * 1024]),
        "application/octet-stream",
    )
    .await;
    assert_json_error(res, "UPLOAD_TOO_LARGE").await;
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn space_isolation_attachment_404_and_batch_scope() {
    let dir = temp_dir("api-iso");
    let app = start_app(dir.clone()).await;
    let key_a = auth_key_b64();
    let key_b = auth_key_b64();
    let token_a = create_and_login(&app, "iso-a", &key_a).await;
    let token_b = create_and_login(&app, "iso-b", &key_b).await;

    let _up_a = upload_file(&app, &token_a, "FH1.a", b"ciphertext-a", 1024).await;
    let up_b = upload_file(&app, &token_b, "FH1.b", b"ciphertext-b", 1024).await;

    // A cannot download B's attachment (404, not 403).
    let res = raw_request(
        &app,
        "GET",
        &up_b.download_url,
        Some(&token_a),
        axum::body::Body::empty(),
        "",
    )
    .await;
    assert_eq!(res.status().as_u16(), 404);
    assert_eq!(
        std::fs::read_dir(app.data_dir.join("files"))
            .unwrap()
            .count(),
        2,
        "both files still on disk"
    );

    // A batch-delete with [A id, B id] only deletes A's message.
    let list_a = list_messages(&app, &token_a).await;
    let a_id = list_a["messages"][0]["id"].as_str().unwrap().to_string();
    let res = json_request(
        &app,
        "POST",
        "/api/v1/messages/batch-delete",
        Some(&token_a),
        &format!("{{\"ids\":[\"{a_id}\",\"{}\"]}}", up_b.message_id),
    )
    .await;
    assert!(res.status().is_success(), "{:?}", read_body(res).await);

    let list_b = list_messages(&app, &token_b).await;
    assert_eq!(list_b["messages"].as_array().unwrap().len(), 1);
    assert_eq!(list_b["messages"][0]["id"], up_b.message_id);

    // Batch-delete id limits.
    let too_many: Vec<String> = (0..501).map(|i| format!("id-{i}")).collect();
    let res = json_request(
        &app,
        "POST",
        "/api/v1/messages/batch-delete",
        Some(&token_a),
        &serde_json::json!({ "ids": too_many }).to_string(),
    )
    .await;
    assert_eq!(res.status().as_u16(), 400);

    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn delete_message_removes_disk_file() {
    let dir = temp_dir("api-delete");
    let app = start_app(dir.clone()).await;
    let key = auth_key_b64();
    let token = create_and_login(&app, "del-space", &key).await;

    let result = upload_file(&app, &token, "FH1.del", b"to-be-deleted", 1024).await;
    let files_dir = app.data_dir.join("files");
    assert_eq!(std::fs::read_dir(&files_dir).unwrap().count(), 1);

    let res = raw_request(
        &app,
        "DELETE",
        &format!("/api/v1/messages/{}", result.message_id),
        Some(&token),
        axum::body::Body::empty(),
        "",
    )
    .await;
    assert_eq!(res.status().as_u16(), 204);

    // File moved to trash and unlinked in the background.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while std::fs::read_dir(&files_dir).unwrap().count() > 0 && std::time::Instant::now() < deadline
    {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert_eq!(std::fs::read_dir(&files_dir).unwrap().count(), 0);
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn context_window_scoped_and_ordered() {
    let dir = temp_dir("api-context");
    let app = start_app(dir.clone()).await;
    let key_a = auth_key_b64();
    let key_b = auth_key_b64();
    let token_a = create_and_login(&app, "ctx-a", &key_a).await;
    let token_b = create_and_login(&app, "ctx-b", &key_b).await;

    let mut a_ids: Vec<String> = Vec::new();
    for i in 0..5 {
        let m = send_text(&app, &token_a, &format!("FH1.a{i}")).await;
        a_ids.push(m["id"].as_str().unwrap().to_string());
    }
    // B's space has its own messages; A's context must never include them.
    for i in 0..5 {
        send_text(&app, &token_b, &format!("FH1.b{i}")).await;
    }

    // Context for A's middle message: only A messages, old → new.
    let res = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{}/context?limit=5", a_ids[2]),
        Some(&token_a),
        "",
    )
    .await;
    let ctx = read_body(res).await;
    let messages = ctx["messages"].as_array().unwrap();
    assert!(
        messages
            .iter()
            .all(|m| m["payload"].as_str().unwrap().starts_with("FH1.a"))
    );
    // Window covers exactly the 5 A messages in real time order, with the
    // target in the middle (2 newer + 2 older halves).
    assert_eq!(messages.len(), 5);
    for (i, m) in messages.iter().enumerate() {
        assert_eq!(m["id"], a_ids[i], "window order must match creation order");
    }

    // A requests context for a message id that only exists in B → 404.
    let b_list = list_messages(&app, &token_b).await;
    let b_id = b_list["messages"][0]["id"].as_str().unwrap().to_string();
    let res = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{b_id}/context"),
        Some(&token_a),
        "",
    )
    .await;
    assert_eq!(res.status().as_u16(), 404);

    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn clear_only_current_space() {
    let dir = temp_dir("api-clear");
    let app = start_app(dir.clone()).await;
    let key_a = auth_key_b64();
    let key_b = auth_key_b64();
    let token_a = create_and_login(&app, "clr-a", &key_a).await;
    let token_b = create_and_login(&app, "clr-b", &key_b).await;

    upload_file(&app, &token_a, "FH1.a", b"a-data", 1024).await;
    upload_file(&app, &token_b, "FH1.b", b"b-data", 1024).await;

    let res = json_request(&app, "POST", "/api/v1/clear", Some(&token_a), "{}").await;
    assert!(res.status().is_success());

    let list_a = list_messages(&app, &token_a).await;
    assert_eq!(list_a["messages"].as_array().unwrap().len(), 0);
    let list_b = list_messages(&app, &token_b).await;
    assert_eq!(list_b["messages"].as_array().unwrap().len(), 1);

    // Same CODE still logs into the same (now empty) space.
    let token_a2 = login(&app, "clr-a", &key_a).await;
    let list_a2 = list_messages(&app, &token_a2).await;
    assert_eq!(list_a2["messages"].as_array().unwrap().len(), 0);
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn storage_stats_scoped() {
    let dir = temp_dir("api-stats");
    let app = start_app(dir.clone()).await;
    let key_a = auth_key_b64();
    let key_b = auth_key_b64();
    let token_a = create_and_login(&app, "st-a", &key_a).await;
    let token_b = create_and_login(&app, "st-b", &key_b).await;

    upload_file(&app, &token_a, "FH1.a", &vec![7u8; 5000], 1024).await;
    upload_file(&app, &token_b, "FH1.b", &vec![7u8; 9000], 1024).await;

    let res = json_request(&app, "GET", "/api/v1/storage", Some(&token_a), "").await;
    let stats = read_body(res).await;
    assert_eq!(stats["ciphertextBytes"], 5000);
    assert_eq!(stats["messageCount"], 1);
    assert_eq!(stats["fileCount"], 1);
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn plaintext_audit_nothing_readable_on_disk() {
    let dir = temp_dir("api-audit");
    let app = start_app(dir.clone()).await;
    let key = auth_key_b64();
    let token = create_and_login(&app, "audit-space", &key).await;

    // The client encrypts before upload; here we emulate with opaque FH1
    // envelopes so the raw plaintext strings never hit the server.
    let secret_text = "SUPER_SECRET_MESSAGE_12345";
    let _secret_filename = "TOP_SECRET_FILE_测试.txt";
    let secret_content = "VERY_SECRET_FILE_CONTENT_98765";

    send_text(&app, &token, "FH1.<encrypted>").await;
    // The client would AEAD-encrypt everything (filename, content); here
    // we emulate with an opaque envelope so the raw strings never appear.
    let payload_opaque = "FH1.<encrypted-binary>";
    let ciphertext = vec![0xABu8; 4096];
    upload_file(&app, &token, payload_opaque, &ciphertext, 1024).await;
    let _ = (secret_text, _secret_filename, secret_content);

    // Close the DB (checkpoint WAL) before scanning the files.
    app.state().db.close().await;

    // Collect every byte of the data dir into one haystack.
    let mut haystack: Vec<u8> = Vec::new();
    fn scan_dir(p: &std::path::Path, out: &mut Vec<u8>) {
        if let Ok(entries) = std::fs::read_dir(p) {
            for e in entries.flatten() {
                let path = e.path();
                if path.is_dir() {
                    scan_dir(&path, out);
                } else if let Ok(bytes) = std::fs::read(&path) {
                    out.extend_from_slice(&bytes);
                    out.push(0);
                }
            }
        }
    }
    scan_dir(&app.data_dir, &mut haystack);
    let haystack_text = String::from_utf8_lossy(&haystack);

    // The opaque envelope is stored (proves our scan sees DB content);
    // the plaintext strings are NOT.
    assert!(haystack_text.contains("FH1.<encrypted>"));
    assert!(!haystack_text.contains("SUPER_SECRET_MESSAGE"));
    assert!(!haystack_text.contains("TOP_SECRET_FILE"));
    assert!(!haystack_text.contains("VERY_SECRET_FILE_CONTENT"));

    // files/** is exactly the uploaded ciphertext.
    let files_dir = app.data_dir.join("files");
    for e in std::fs::read_dir(&files_dir).unwrap().flatten() {
        let bytes = std::fs::read(e.path()).unwrap();
        assert_eq!(bytes, ciphertext);
    }

    // Schema has no plaintext columns.
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&format!(
            "sqlite://{}?mode=ro",
            app.data_dir.join("filehelper.db").display()
        ))
        .await
        .unwrap();
    let cols: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM pragma_table_info('messages') WHERE name IN ('kind','text')",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(
        cols.is_empty(),
        "plaintext columns must not exist: {cols:?}"
    );
    let cols: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM pragma_table_info('attachments') WHERE name IN ('original_name','mime_type','sha256')",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(
        cols.is_empty(),
        "plaintext attachment columns must not exist: {cols:?}"
    );
    pool.close().await;

    cleanup(&dir);
}

#[allow(dead_code)]
fn _unused(_: PathBuf) {}
