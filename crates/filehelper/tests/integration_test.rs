mod common;
use common::*;

use filehelper::db;
use sqlx::SqlitePool;

async fn pool_of(app: &filehelper::app::App) -> SqlitePool {
    app.state().db.clone()
}

#[tokio::test]
async fn schema_has_encrypted_tables_and_indexes() {
    let dir = temp_dir("int-schema");
    let app = start_app(dir.clone()).await;
    let pool = pool_of(&app).await;

    for table in ["meta", "spaces", "messages", "attachments"] {
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        )
        .bind(table)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1, "table {table} must exist");
    }

    let idx = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name IN ('idx_messages_space_time','idx_attachments_space_message')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(idx, 2, "space/time composite indexes must exist");

    // No FTS tables.
    let fts =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sqlite_master WHERE name LIKE '%fts%'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(fts, 0, "server-side FTS must be gone");

    let version: String = sqlx::query_scalar("SELECT value FROM meta WHERE key='schema_version'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(version, "3");
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn instance_id_created_once_and_stored() {
    let dir = temp_dir("int-instance");
    let app = start_app(dir.clone()).await;
    let pool = pool_of(&app).await;
    let stored: String = sqlx::query_scalar("SELECT value FROM meta WHERE key='instance_id'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored, app.state().config.instance_id);
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn spaces_create_and_verify_auth() {
    let dir = temp_dir("int-spaces");
    let app = start_app(dir.clone()).await;
    let pool = pool_of(&app).await;

    let verifier = [7u8; 32];
    db::spaces::create_space(&pool, "space-1", &verifier)
        .await
        .unwrap();
    // Duplicate → SpaceExists.
    let err = db::spaces::create_space(&pool, "space-1", &verifier)
        .await
        .unwrap_err();
    assert!(matches!(err, filehelper::error::AppError::SpaceExists));

    // Correct verifier passes, wrong one fails, unknown space → NotFound.
    db::spaces::verify_space(&pool, "space-1", &verifier)
        .await
        .unwrap();
    let wrong = [9u8; 32];
    let err = db::spaces::verify_space(&pool, "space-1", &wrong)
        .await
        .unwrap_err();
    assert!(matches!(err, filehelper::error::AppError::AuthFailed));
    let err = db::spaces::verify_space(&pool, "nope", &verifier)
        .await
        .unwrap_err();
    assert!(matches!(err, filehelper::error::AppError::SpaceNotFound));
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn messages_pagination_and_tuple_cursor() {
    let dir = temp_dir("int-pagination");
    let app = start_app(dir.clone()).await;
    let pool = pool_of(&app).await;
    db::spaces::create_space(&pool, "page-space", &[1u8; 32])
        .await
        .unwrap();

    // Insert 25 messages in two spaces (interleaved so timestamps are
    // mixed) and paginate 10 at a time.
    for i in 0..25 {
        let _ = db::insert_message(&pool, "page-space", &format!("FH1.msg-{i}"), None)
            .await
            .unwrap();
    }
    db::spaces::create_space(&pool, "other-space", &[2u8; 32])
        .await
        .unwrap();
    db::insert_message(&pool, "other-space", "FH1.other", None)
        .await
        .unwrap();

    let page1 = db::list_messages(&pool, "page-space", None, 10)
        .await
        .unwrap();
    assert_eq!(page1.messages.len(), 10);
    assert!(page1.next_cursor.is_some());

    let page2 = db::list_messages(&pool, "page-space", page1.next_cursor.clone(), 10)
        .await
        .unwrap();
    assert_eq!(page2.messages.len(), 10);

    let page3 = db::list_messages(&pool, "page-space", page2.next_cursor.clone(), 10)
        .await
        .unwrap();
    assert_eq!(page3.messages.len(), 5);
    assert!(page3.next_cursor.is_none());

    // Union covers all 25 exactly once.
    let mut seen: Vec<String> = page1
        .messages
        .iter()
        .chain(page2.messages.iter())
        .chain(page3.messages.iter())
        .map(|m| m.id.clone())
        .collect();
    seen.sort();
    seen.dedup();
    assert_eq!(seen.len(), 25);

    // Other space's message is never visible.
    assert!(
        page1
            .messages
            .iter()
            .chain(page2.messages.iter())
            .chain(page3.messages.iter())
            .all(|m| m.payload != "FH1.other")
    );
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn delete_messages_cascades_attachments_and_scopes() {
    let dir = temp_dir("int-delete");
    let app = start_app(dir.clone()).await;
    let pool = pool_of(&app).await;
    db::spaces::create_space(&pool, "del-space", &[1u8; 32])
        .await
        .unwrap();

    let m1 = db::insert_message(
        &pool,
        "del-space",
        "FH1.one",
        Some(db::NewAttachment {
            id: "att-1".into(),
            storage_name: "storage-1".into(),
            ciphertext_size: 100,
        }),
    )
    .await
    .unwrap();
    db::insert_message(&pool, "del-space", "FH1.two", None)
        .await
        .unwrap();

    // Only m1's storage name comes back; attachment row cascades away.
    let names = db::delete_messages(&pool, "del-space", &[m1.id.clone(), "ghost-id".into()])
        .await
        .unwrap();
    assert_eq!(names, vec!["storage-1".to_string()]);

    let att_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM attachments")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(att_count, 0);
    let msg_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM messages")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(msg_count, 1);
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn context_window_old_to_new() {
    let dir = temp_dir("int-context");
    let app = start_app(dir.clone()).await;
    let pool = pool_of(&app).await;
    db::spaces::create_space(&pool, "ctx-space", &[1u8; 32])
        .await
        .unwrap();

    let mut ids: Vec<String> = Vec::new();
    for i in 0..20 {
        let m = db::insert_message(&pool, "ctx-space", &format!("FH1.m{i}"), None)
            .await
            .unwrap();
        ids.push(m.id);
    }

    let ctx = db::get_message_context(&pool, "ctx-space", &ids[10], 9)
        .await
        .unwrap()
        .unwrap();
    // Old → new, exactly the expected window (target + half newer).
    let payloads: Vec<String> = ctx.messages.iter().map(|m| m.payload.clone()).collect();
    assert_eq!(
        payloads,
        vec![
            "FH1.m6".to_string(),
            "FH1.m7".to_string(),
            "FH1.m8".to_string(),
            "FH1.m9".to_string(),
            "FH1.m10".to_string(),
            "FH1.m11".to_string(),
            "FH1.m12".to_string(),
            "FH1.m13".to_string(),
            "FH1.m14".to_string(),
        ]
    );

    // Cross-space lookup returns None.
    assert!(
        db::get_message_context(&pool, "nope", &ids[10], 9)
            .await
            .unwrap()
            .is_none()
    );
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn clear_space_keeps_auth_record() {
    let dir = temp_dir("int-clear");
    let app = start_app(dir.clone()).await;
    let pool = pool_of(&app).await;
    db::spaces::create_space(&pool, "clear-space", &[1u8; 32])
        .await
        .unwrap();
    db::insert_message(
        &pool,
        "clear-space",
        "FH1.x",
        Some(db::NewAttachment {
            id: "att-x".into(),
            storage_name: "storage-x".into(),
            ciphertext_size: 5,
        }),
    )
    .await
    .unwrap();

    let names = db::clear_space(&pool, "clear-space").await.unwrap();
    assert_eq!(names, vec!["storage-x".to_string()]);

    let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM messages")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    let spaces = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM spaces")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(spaces, 1, "space auth record must survive clear");
    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn storage_stats_are_space_scoped() {
    let dir = temp_dir("int-stats");
    let app = start_app(dir.clone()).await;
    let pool = pool_of(&app).await;
    db::spaces::create_space(&pool, "s-a", &[1u8; 32])
        .await
        .unwrap();
    db::spaces::create_space(&pool, "s-b", &[2u8; 32])
        .await
        .unwrap();

    for (space, size) in [("s-a", 111i64), ("s-a", 222i64), ("s-b", 333i64)] {
        db::insert_message(
            &pool,
            space,
            "FH1",
            Some(db::NewAttachment {
                id: format!("att-{space}-{size}"),
                storage_name: format!("st-{space}-{size}"),
                ciphertext_size: size,
            }),
        )
        .await
        .unwrap();
    }

    let stats_a = db::get_storage_stats(&pool, "s-a").await.unwrap();
    assert_eq!(stats_a["ciphertextBytes"], 333);
    assert_eq!(stats_a["messageCount"], 2);
    assert_eq!(stats_a["fileCount"], 2);

    let stats_b = db::get_storage_stats(&pool, "s-b").await.unwrap();
    assert_eq!(stats_b["ciphertextBytes"], 333);
    assert_eq!(stats_b["messageCount"], 1);
    assert_eq!(stats_b["fileCount"], 1);

    app.shutdown().await;
    cleanup(&dir);
}

#[tokio::test]
async fn attachments_are_scoped_by_space() {
    let dir = temp_dir("int-att");
    let app = start_app(dir.clone()).await;
    let pool = pool_of(&app).await;
    db::spaces::create_space(&pool, "att-a", &[1u8; 32])
        .await
        .unwrap();
    db::spaces::create_space(&pool, "att-b", &[2u8; 32])
        .await
        .unwrap();
    let m = db::insert_message(&pool, "att-a", "FH1", None)
        .await
        .unwrap();
    db::insert_message(
        &pool,
        "att-a",
        "FH1",
        Some(db::NewAttachment {
            id: "att-a-1".into(),
            storage_name: "sa-1".into(),
            ciphertext_size: 10,
        }),
    )
    .await
    .unwrap();
    let _ = m;
    assert!(
        db::attachments::get_attachment(&pool, "att-a", "att-a-1")
            .await
            .unwrap()
            .is_some()
    );
    assert!(
        db::attachments::get_attachment(&pool, "att-b", "att-a-1")
            .await
            .unwrap()
            .is_none(),
        "another space must not see the attachment"
    );
    app.shutdown().await;
    cleanup(&dir);
}
