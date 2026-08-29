#![allow(dead_code)]
use crate::error::AppError;
use sqlx::SqlitePool;

#[derive(Debug, sqlx::FromRow)]
pub struct AttachmentInfo {
    pub id: String,
    pub storage_name: String,
    pub ciphertext_size: i64,
    pub space_id: String,
}

/// Fetch an attachment, scoped to the authenticated space. Returns None
/// when the attachment belongs to another space (treated as absent).
pub async fn get_attachment(
    pool: &SqlitePool,
    space_id: &str,
    id: &str,
) -> Result<Option<AttachmentInfo>, AppError> {
    sqlx::query_as::<_, AttachmentInfo>(
        "SELECT id, storage_name, ciphertext_size, space_id
         FROM attachments WHERE id = ?1 AND space_id = ?2",
    )
    .bind(id)
    .bind(space_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.into())
}

pub async fn list_storage_names(pool: &SqlitePool) -> Result<Vec<String>, AppError> {
    sqlx::query_scalar::<_, String>("SELECT storage_name FROM attachments")
        .fetch_all(pool)
        .await
        .map_err(|e| e.into())
}
