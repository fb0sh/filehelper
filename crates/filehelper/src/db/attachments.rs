#![allow(dead_code)]
use crate::error::AppError;
use sqlx::SqlitePool;

pub async fn get_attachment(
    pool: &SqlitePool,
    id: &str,
) -> Result<Option<AttachmentInfo>, AppError> {
    sqlx::query_as::<_, AttachmentInfo>(
        r#"
        SELECT a.id, a.original_name, a.mime_type, a.size_bytes, a.sha256, a.storage_name, a.created_at_ms,
               m.id as message_id, m.created_at_ms as message_created_at_ms
        FROM attachments a
        JOIN messages m ON m.id = a.message_id
        WHERE a.id = ?1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.into())
}

#[derive(Debug, sqlx::FromRow)]
pub struct AttachmentInfo {
    pub id: String,
    pub original_name: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub sha256: String,
    pub storage_name: String,
    pub created_at_ms: i64,
    pub message_id: String,
    pub message_created_at_ms: i64,
}

pub async fn get_orphan_files(pool: &SqlitePool) -> Result<Vec<String>, AppError> {
    // Get all storage names from attachments
    let names = sqlx::query_scalar::<_, String>("SELECT storage_name FROM attachments")
        .fetch_all(pool)
        .await?;
    Ok(names)
}
