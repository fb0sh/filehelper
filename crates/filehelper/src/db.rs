pub mod attachments;
pub mod messages;
pub mod search;

pub use messages::*;

use sqlx::SqlitePool;

// Bump to rebuild the FTS index after a schema change.
const FTS_SCHEMA_VERSION: &str = "2";

pub async fn init_db(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("PRAGMA journal_mode=WAL;")
        .execute(pool)
        .await?;
    sqlx::query("PRAGMA foreign_keys=ON;").execute(pool).await?;
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

    ensure_fts_schema(pool).await?;

    Ok(())
}

// Standalone FTS5 index over (message text, attachment filename).
// Kept in sync explicitly by insert_message/delete_message — no triggers,
// because filename lives in another table and trigger-based external
// content tables can't see it.
async fn ensure_fts_schema(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let version =
        sqlx::query_scalar::<_, String>("SELECT value FROM meta WHERE key = 'fts_schema_version'")
            .fetch_optional(pool)
            .await?;

    if version.as_deref() == Some(FTS_SCHEMA_VERSION) {
        return Ok(());
    }

    // Drop legacy trigger-based schema if present.
    sqlx::query("DROP TRIGGER IF EXISTS messages_ai")
        .execute(pool)
        .await?;
    sqlx::query("DROP TRIGGER IF EXISTS messages_ad")
        .execute(pool)
        .await?;
    sqlx::query("DROP TRIGGER IF EXISTS messages_au")
        .execute(pool)
        .await?;
    sqlx::query("DROP TABLE IF EXISTS messages_fts")
        .execute(pool)
        .await?;

    sqlx::query(
        r#"
        CREATE VIRTUAL TABLE messages_fts USING fts5(
            text, filename, message_id UNINDEXED
        );
        "#,
    )
    .execute(pool)
    .await?;

    // Backfill from existing data.
    sqlx::query(
        r#"
        INSERT INTO messages_fts(message_id, text, filename)
        SELECT m.id, COALESCE(m.text, ''), COALESCE(a.original_name, '')
        FROM messages m
        LEFT JOIN attachments a ON a.message_id = m.id
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "INSERT INTO meta (key, value) VALUES ('fts_schema_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(FTS_SCHEMA_VERSION)
    .execute(pool)
    .await?;

    tracing::info!("FTS index rebuilt (schema version {FTS_SCHEMA_VERSION})");
    Ok(())
}
