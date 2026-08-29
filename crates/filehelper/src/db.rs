pub mod attachments;
pub mod messages;
pub mod spaces;

pub use messages::*;

use sqlx::SqlitePool;

pub const SCHEMA_VERSION: &str = "3";
pub const CRYPTO_VERSION: u32 = 1;

/// Detect a pre-E2EE (legacy) FileHelper database: it has a `messages`
/// table with the old plaintext schema and no `spaces` table. New
/// databases are created with the encrypted schema.
pub async fn detect_legacy(pool: &SqlitePool) -> Result<bool, sqlx::Error> {
    let has_spaces = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='spaces'",
    )
    .fetch_one(pool)
    .await?;
    if has_spaces > 0 {
        return Ok(false);
    }
    let has_messages = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='messages'",
    )
    .fetch_one(pool)
    .await?;
    if has_messages > 0 {
        return Ok(true);
    }
    let has_legacy_meta =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM meta WHERE key='access_code_hash'")
            .fetch_one(pool)
            .await?;
    Ok(has_legacy_meta > 0)
}

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
        CREATE TABLE IF NOT EXISTS spaces (
            id TEXT PRIMARY KEY,
            auth_verifier BLOB NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            space_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_messages_space_time
        ON messages(space_id, created_at_ms DESC, id DESC);
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            space_id TEXT NOT NULL,
            storage_name TEXT NOT NULL,
            ciphertext_size INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
            FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_attachments_space_message
        ON attachments(space_id, message_id);
        "#,
    )
    .execute(pool)
    .await?;

    // Schema version bookkeeping.
    sqlx::query(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(SCHEMA_VERSION)
    .execute(pool)
    .await?;

    Ok(())
}

/// Instance id: created once on first init, stable across restarts so the
/// same CODE derives the same keys. --ephemeral uses a fresh temp dir, so
/// it naturally gets a fresh instance id.
pub async fn get_or_create_instance_id(pool: &SqlitePool) -> Result<String, sqlx::Error> {
    let existing =
        sqlx::query_scalar::<_, String>("SELECT value FROM meta WHERE key = 'instance_id'")
            .fetch_optional(pool)
            .await?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let mut bytes = [0u8; 32];
    use rand::RngCore;
    rand::thread_rng().fill_bytes(&mut bytes);
    let id = base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, bytes);
    sqlx::query("INSERT INTO meta (key, value) VALUES ('instance_id', ?1)")
        .bind(&id)
        .execute(pool)
        .await?;
    Ok(id)
}
