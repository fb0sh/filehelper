pub mod messages;
pub mod attachments;
pub mod search;

pub use messages::*;

use sqlx::SqlitePool;

pub async fn init_db(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("PRAGMA journal_mode=WAL;")
        .execute(pool)
        .await?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(pool)
        .await?;
    sqlx::query("PRAGMA busy_timeout=5000;")
        .execute(pool)
        .await?;
    sqlx::query("PRAGMA synchronous=NORMAL;")
        .execute(pool)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            text TEXT,
            created_at_ms INTEGER NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_messages_created_at
        ON messages(created_at_ms DESC);
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            original_name TEXT NOT NULL,
            mime_type TEXT,
            size_bytes INTEGER NOT NULL,
            sha256 TEXT NOT NULL,
            storage_name TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_attachments_message_id
        ON attachments(message_id);
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
            text, filename, content='messages', content_rowid='rowid'
        );
        "#,
    )
    .execute(pool)
    .await?;

    // Create triggers for FTS sync
    sqlx::query(
        r#"
        CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
        END;
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text);
        END;
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text);
            INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
        END;
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}