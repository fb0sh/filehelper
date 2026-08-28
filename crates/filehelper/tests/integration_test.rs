mod common;

use common::{cleanup, make_session_cookie, setup_test_app};
use filehelper::auth::password;
use filehelper::db;

#[tokio::test]
async fn test_config_cli() {
    use clap::Parser;
    let config = filehelper::config::Config::parse_from([
        "filehelper",
        "--addr", "0.0.0.0:9090",
        "--password", "mypass",
        "--data-dir", "/tmp/fh-test",
        "--max-upload-size", "1048576",
        "--session-ttl", "7d",
        "--name", "TestApp",
    ]);
    assert_eq!(config.addr, "0.0.0.0:9090");
    assert_eq!(config.password, Some("mypass".to_string()));
    assert_eq!(config.data_dir.to_string_lossy(), "/tmp/fh-test");
    assert_eq!(config.max_upload_size, 1048576);
    assert_eq!(config.session_ttl, "7d");
    assert_eq!(config.name, "TestApp");
    assert!(!config.no_auth);
}

#[tokio::test]
async fn test_password_hash_and_verify() {
    let hash = password::hash_password("secret123").unwrap();
    assert!(password::verify_password("secret123", &hash).unwrap());
    assert!(!password::verify_password("wrong", &hash).unwrap());
}

#[tokio::test]
async fn test_db_migration() {
    let (state, tmp) = setup_test_app().await;
    let rows: Vec<(String,)> = sqlx::query_as("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .fetch_all(&state.db)
        .await
        .unwrap();
    let names: Vec<&str> = rows.iter().map(|r| r.0.as_str()).collect();
    assert!(names.contains(&"messages"));
    assert!(names.contains(&"attachments"));
    assert!(names.contains(&"meta"));
    cleanup(&tmp);
}

#[tokio::test]
async fn test_message_insert_and_list() {
    let (state, tmp) = setup_test_app().await;

    let msg = db::insert_message(&state.db, &db::NewMessage {
        kind: "text".to_string(),
        text: Some("Hello world".to_string()),
        attachment: None,
    }).await.unwrap();

    assert_eq!(msg.kind, "text");
    assert_eq!(msg.text.as_deref(), Some("Hello world"));
    assert!(msg.attachment.is_none());

    let list = db::list_messages(&state.db, None, 50).await.unwrap();
    assert_eq!(list.messages.len(), 1);
    assert_eq!(list.messages[0].id, msg.id);
    assert!(list.next_cursor.is_none());

    cleanup(&tmp);
}

#[tokio::test]
async fn test_message_pagination() {
    let (state, tmp) = setup_test_app().await;

    for i in 0..5 {
        db::insert_message(&state.db, &db::NewMessage {
            kind: "text".to_string(),
            text: Some(format!("Message {i}")),
            attachment: None,
        }).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    }

    let page1 = db::list_messages(&state.db, None, 3).await.unwrap();
    assert_eq!(page1.messages.len(), 3);
    assert!(page1.next_cursor.is_some());

    let cursor = page1.next_cursor.unwrap();
    let page2 = db::list_messages(&state.db, Some(cursor), 3).await.unwrap();
    assert_eq!(page2.messages.len(), 2);
    assert!(page2.next_cursor.is_none());

    cleanup(&tmp);
}

#[tokio::test]
async fn test_message_delete() {
    let (state, tmp) = setup_test_app().await;

    let msg = db::insert_message(&state.db, &db::NewMessage {
        kind: "text".to_string(),
        text: Some("To be deleted".to_string()),
        attachment: None,
    }).await.unwrap();

    db::delete_message(&state.db, &msg.id).await.unwrap();

    let list = db::list_messages(&state.db, None, 50).await.unwrap();
    assert!(list.messages.is_empty());

    cleanup(&tmp);
}

#[tokio::test]
async fn test_message_attachment_cascade() {
    let (state, tmp) = setup_test_app().await;

    let msg = db::insert_message(&state.db, &db::NewMessage {
        kind: "document".to_string(),
        text: None,
        attachment: Some(db::NewAttachment {
            original_name: "test.txt".to_string(),
            mime_type: Some("text/plain".to_string()),
            size_bytes: 100,
            sha256: "abc123".to_string(),
            storage_name: "storage-uuid".to_string(),
        }),
    }).await.unwrap();

    assert!(msg.attachment.is_some());

    // Delete message, attachment should cascade
    db::delete_message(&state.db, &msg.id).await.unwrap();

    let att = filehelper::db::attachments::get_attachment(&state.db, &msg.attachment.unwrap().id).await.unwrap();
    assert!(att.is_none());

    cleanup(&tmp);
}

#[tokio::test]
async fn test_storage_stats() {
    let (state, tmp) = setup_test_app().await;

    db::insert_message(&state.db, &db::NewMessage {
        kind: "image".to_string(),
        text: None,
        attachment: Some(db::NewAttachment {
            original_name: "photo.jpg".to_string(),
            mime_type: Some("image/jpeg".to_string()),
            size_bytes: 1024,
            sha256: "hash1".to_string(),
            storage_name: "s1".to_string(),
        }),
    }).await.unwrap();

    let stats = db::get_storage_stats(&state.db).await.unwrap();
    assert_eq!(stats["total"], 1024);
    assert_eq!(stats["images"], 1024);
    assert_eq!(stats["videos"], 0);

    cleanup(&tmp);
}

#[tokio::test]
async fn test_search() {
    let (state, tmp) = setup_test_app().await;

    db::insert_message(&state.db, &db::NewMessage {
        kind: "text".to_string(),
        text: Some("Find this unique text".to_string()),
        attachment: None,
    }).await.unwrap();

    // Wait a moment for FTS index
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let results = db::search::search_messages(&state.db, "unique", 10).await.unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].text.as_deref(), Some("Find this unique text"));

    cleanup(&tmp);
}

#[tokio::test]
async fn test_session_cookie() {
    let (state, tmp) = setup_test_app().await;
    let cookie = make_session_cookie(&state);
    assert!(cookie.starts_with("filehelper_session="));
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("SameSite=Strict"));
    cleanup(&tmp);
}

#[tokio::test]
async fn test_password_derive_keys() {
    let salt: [u8; 32] = [1; 32];
    let (auth_key, session_key) = password::derive_keys("test", &salt);
    assert_eq!(auth_key.len(), 32);
    assert_eq!(session_key.len(), 32);
    // Different keys for different purposes
    assert_ne!(auth_key, session_key);
}