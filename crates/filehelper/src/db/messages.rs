#![allow(dead_code)]
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

/// Server-side encrypted message record. The `payload` is opaque to the
/// server — the client encrypts and decrypts it locally.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedMessage {
    pub id: String,
    pub payload: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub attachment: Option<EncryptedAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedAttachment {
    pub id: String,
    #[serde(rename = "ciphertextSize")]
    pub ciphertext_size: i64,
    #[serde(rename = "downloadUrl")]
    pub download_url: String,
}

#[derive(Debug, Serialize)]
pub struct MessageListResponse {
    pub messages: Vec<EncryptedMessage>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MessageContextResponse {
    /// Messages ordered old → new, target message included.
    pub messages: Vec<EncryptedMessage>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct MessageRow {
    id: String,
    space_id: String,
    payload: String,
    created_at_ms: i64,
    a_id: Option<String>,
    a_ciphertext_size: Option<i64>,
    a_storage_name: Option<String>,
}

const MESSAGE_SELECT: &str = r#"
    SELECT m.id, m.space_id, m.payload, m.created_at_ms,
           a.id as a_id, a.ciphertext_size as a_ciphertext_size, a.storage_name as a_storage_name
    FROM messages m
    LEFT JOIN attachments a ON a.message_id = m.id
"#;

fn row_to_message(row: &MessageRow) -> EncryptedMessage {
    EncryptedMessage {
        id: row.id.clone(),
        payload: row.payload.clone(),
        created_at: chrono::DateTime::from_timestamp_millis(row.created_at_ms)
            .unwrap()
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string(),
        attachment: row.a_id.as_ref().map(|aid| EncryptedAttachment {
            id: aid.clone(),
            ciphertext_size: row.a_ciphertext_size.unwrap_or(0),
            download_url: format!("/api/v1/files/{aid}/download"),
        }),
    }
}

/// List newest-first messages for one space with tuple-cursor pagination.
pub async fn list_messages(
    pool: &SqlitePool,
    space_id: &str,
    before: Option<String>,
    limit: i64,
) -> Result<MessageListResponse, AppError> {
    let limit = limit.clamp(1, 500);
    let rows = if let Some(ref cursor) = before {
        sqlx::query_as::<_, MessageRow>(&format!(
            "{MESSAGE_SELECT}
             WHERE m.space_id = ?1
               AND (m.created_at_ms < (SELECT created_at_ms FROM messages WHERE id = ?2)
                    OR (m.created_at_ms = (SELECT created_at_ms FROM messages WHERE id = ?2)
                        AND m.id < ?2))
             ORDER BY m.created_at_ms DESC, m.id DESC
             LIMIT ?3"
        ))
        .bind(space_id)
        .bind(cursor)
        .bind(limit + 1)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, MessageRow>(&format!(
            "{MESSAGE_SELECT}
             WHERE m.space_id = ?1
             ORDER BY m.created_at_ms DESC, m.id DESC
             LIMIT ?2"
        ))
        .bind(space_id)
        .bind(limit + 1)
        .fetch_all(pool)
        .await?
    };

    let has_more = rows.len() > limit as usize;
    let rows = if has_more {
        &rows[..limit as usize]
    } else {
        &rows
    };

    let next_cursor = if has_more {
        rows.last().map(|r| r.id.clone())
    } else {
        None
    };

    let mut messages: Vec<EncryptedMessage> = rows.iter().map(row_to_message).collect();
    messages.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));

    Ok(MessageListResponse {
        messages,
        next_cursor,
    })
}

/// Insert an encrypted message into a space. Returns the stored record.
pub async fn insert_message(
    pool: &SqlitePool,
    space_id: &str,
    payload: &str,
    attachment: Option<NewAttachment>,
) -> Result<EncryptedMessage, AppError> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let id = uuid::Uuid::now_v7().to_string();

    let mut tx = pool.begin().await?;

    sqlx::query(
        "INSERT INTO messages (id, space_id, payload, created_at_ms) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(&id)
    .bind(space_id)
    .bind(payload)
    .bind(now_ms)
    .execute(&mut *tx)
    .await?;

    let attachment_out = if let Some(att) = attachment {
        sqlx::query(
            r#"
            INSERT INTO attachments (id, message_id, space_id, storage_name, ciphertext_size, created_at_ms)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
        )
        .bind(&att.id)
        .bind(&id)
        .bind(space_id)
        .bind(&att.storage_name)
        .bind(att.ciphertext_size)
        .bind(now_ms)
        .execute(&mut *tx)
        .await?;
        Some(EncryptedAttachment {
            id: att.id.clone(),
            ciphertext_size: att.ciphertext_size,
            download_url: format!("/api/v1/files/{}/download", att.id),
        })
    } else {
        None
    };

    tx.commit().await?;

    Ok(EncryptedMessage {
        id,
        payload: payload.to_string(),
        created_at: chrono::DateTime::from_timestamp_millis(now_ms)
            .unwrap()
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string(),
        attachment: attachment_out,
    })
}

pub struct NewAttachment {
    pub id: String,
    pub storage_name: String,
    pub ciphertext_size: i64,
}

pub async fn get_message(
    pool: &SqlitePool,
    space_id: &str,
    id: &str,
) -> Result<Option<EncryptedMessage>, AppError> {
    let row = sqlx::query_as::<_, MessageRow>(&format!(
        "{MESSAGE_SELECT} WHERE m.space_id = ?1 AND m.id = ?2"
    ))
    .bind(space_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.as_ref().map(row_to_message))
}

/// Delete messages in one transaction. Only ids belonging to `space_id`
/// are touched; foreign ids are treated as absent. Returns the storage
/// names of deleted attachments so the caller can clean up disk files.
pub async fn delete_messages(
    pool: &SqlitePool,
    space_id: &str,
    ids: &[String],
) -> Result<Vec<String>, AppError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut tx = pool.begin().await?;

    let mut storage_names = Vec::new();
    for id in ids {
        // Read the storage name BEFORE the delete: the FK cascade removes
        // the attachment row together with the message.
        let attachment = sqlx::query_scalar::<_, String>(
            "SELECT storage_name FROM attachments WHERE message_id = ?1 AND space_id = ?2",
        )
        .bind(id)
        .bind(space_id)
        .fetch_optional(&mut *tx)
        .await?;

        let deleted = sqlx::query("DELETE FROM messages WHERE id = ?1 AND space_id = ?2")
            .bind(id)
            .bind(space_id)
            .execute(&mut *tx)
            .await?;
        if deleted.rows_affected() == 0 {
            // Foreign space or absent: nothing was deleted. Do not leak
            // its existence and never disturb names collected for other
            // (real) messages in this batch.
            continue;
        }
        if let Some(name) = attachment {
            storage_names.push(name);
        }
    }

    tx.commit().await?;
    Ok(storage_names)
}

/// Context window around a message, space-scoped. Old → new order.
pub async fn get_message_context(
    pool: &SqlitePool,
    space_id: &str,
    id: &str,
    limit: i64,
) -> Result<Option<MessageContextResponse>, AppError> {
    let limit = limit.clamp(1, 200);
    let target = sqlx::query_scalar::<_, i64>(
        "SELECT created_at_ms FROM messages WHERE id = ?1 AND space_id = ?2",
    )
    .bind(id)
    .bind(space_id)
    .fetch_optional(pool)
    .await?;

    let Some(target_ms) = target else {
        return Ok(None);
    };

    let half = (limit / 2).max(1);

    let newer = sqlx::query_as::<_, MessageRow>(&format!(
        "{MESSAGE_SELECT}
         WHERE m.space_id = ?1
           AND (m.created_at_ms > ?2 OR (m.created_at_ms = ?2 AND m.id > ?3))
         ORDER BY m.created_at_ms ASC, m.id ASC
         LIMIT ?4"
    ))
    .bind(space_id)
    .bind(target_ms)
    .bind(id)
    .bind(half)
    .fetch_all(pool)
    .await?;

    let older_limit = (limit - newer.len() as i64).max(1);
    let mut rows = sqlx::query_as::<_, MessageRow>(&format!(
        "{MESSAGE_SELECT}
         WHERE m.space_id = ?1
           AND (m.created_at_ms < ?2 OR (m.created_at_ms = ?2 AND m.id <= ?3))
         ORDER BY m.created_at_ms DESC, m.id DESC
         LIMIT ?4"
    ))
    .bind(space_id)
    .bind(target_ms)
    .bind(id)
    .bind(older_limit)
    .fetch_all(pool)
    .await?;

    rows.extend(newer);
    rows.sort_by(|a, b| a.created_at_ms.cmp(&b.created_at_ms).then(a.id.cmp(&b.id)));

    let oldest = rows.first();
    let has_older = if let Some(oldest) = oldest {
        sqlx::query_scalar::<_, i64>(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM messages
                WHERE space_id = ?1
                  AND (created_at_ms < ?2 OR (created_at_ms = ?2 AND id < ?3))
            )
            "#,
        )
        .bind(space_id)
        .bind(oldest.created_at_ms)
        .bind(&oldest.id)
        .fetch_one(pool)
        .await?
            == 1
    } else {
        false
    };

    let next_cursor = if has_older {
        oldest.map(|r| r.id.clone())
    } else {
        None
    };

    let messages: Vec<EncryptedMessage> = rows.iter().map(row_to_message).collect();
    Ok(Some(MessageContextResponse {
        messages,
        next_cursor,
    }))
}

/// Clear a single space (Settings → Clear All Data). Keeps the space's
/// auth record so the same CODE still enters the same empty space.
pub async fn clear_space(pool: &SqlitePool, space_id: &str) -> Result<Vec<String>, AppError> {
    let storage_names =
        sqlx::query_scalar::<_, String>("SELECT storage_name FROM attachments WHERE space_id = ?1")
            .bind(space_id)
            .fetch_all(pool)
            .await?;

    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM messages WHERE space_id = ?1")
        .bind(space_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(storage_names)
}

/// Space-scoped storage stats.
pub async fn get_storage_stats(
    pool: &SqlitePool,
    space_id: &str,
) -> Result<serde_json::Value, AppError> {
    let ciphertext = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT COALESCE(SUM(ciphertext_size), 0) FROM attachments WHERE space_id = ?1",
    )
    .bind(space_id)
    .fetch_one(pool)
    .await?
    .unwrap_or(0);

    let messages =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM messages WHERE space_id = ?1")
            .bind(space_id)
            .fetch_one(pool)
            .await?;

    let files =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM attachments WHERE space_id = ?1")
            .bind(space_id)
            .fetch_one(pool)
            .await?;

    Ok(serde_json::json!({
        "ciphertextBytes": ciphertext,
        "messageCount": messages,
        "fileCount": files,
    }))
}
