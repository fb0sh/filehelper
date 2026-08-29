#![allow(dead_code)]
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub kind: String,
    pub text: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub attachment: Option<Attachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub filename: String,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
    pub size: i64,
    pub sha256: String,
    #[serde(rename = "contentUrl")]
    pub content_url: String,
    #[serde(rename = "downloadUrl")]
    pub download_url: String,
}

#[derive(Debug, Serialize)]
pub struct MessageListResponse {
    pub messages: Vec<Message>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: Option<String>,
}

pub async fn list_messages(
    pool: &SqlitePool,
    before: Option<String>,
    limit: i64,
) -> Result<MessageListResponse, AppError> {
    let limit = limit.clamp(1, 100);
    // Cursor compares (created_at_ms, id) tuples: UUIDv7 is monotonic
    // within the same millisecond, so equal-timestamp messages are
    // never skipped by pagination.
    let messages = if let Some(ref cursor) = before {
        sqlx::query_as::<_, MessageRow>(
            r#"
            SELECT m.id, m.kind, m.text, m.created_at_ms,
                   a.id as a_id, a.original_name as a_filename, a.mime_type as a_mime_type,
                   a.size_bytes as a_size, a.sha256 as a_sha256, a.storage_name as a_storage_name,
                   a.created_at_ms as a_created_at_ms
            FROM messages m
            LEFT JOIN attachments a ON a.message_id = m.id
            WHERE m.created_at_ms < (SELECT created_at_ms FROM messages WHERE id = ?1)
               OR (m.created_at_ms = (SELECT created_at_ms FROM messages WHERE id = ?1)
                   AND m.id < ?1)
            ORDER BY m.created_at_ms DESC, m.id DESC
            LIMIT ?2
            "#,
        )
        .bind(cursor)
        .bind(limit + 1)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, MessageRow>(
            r#"
            SELECT m.id, m.kind, m.text, m.created_at_ms,
                   a.id as a_id, a.original_name as a_filename, a.mime_type as a_mime_type,
                   a.size_bytes as a_size, a.sha256 as a_sha256, a.storage_name as a_storage_name,
                   a.created_at_ms as a_created_at_ms
            FROM messages m
            LEFT JOIN attachments a ON a.message_id = m.id
            ORDER BY m.created_at_ms DESC, m.id DESC
            LIMIT ?1
            "#,
        )
        .bind(limit + 1)
        .fetch_all(pool)
        .await?
    };

    let has_more = messages.len() > limit as usize;
    let messages = if has_more {
        &messages[..limit as usize]
    } else {
        &messages
    };

    let next_cursor = if has_more {
        messages.last().map(|m| m.id.clone())
    } else {
        None
    };

    let grouped = group_messages(messages);
    let mut result: Vec<Message> = grouped.into_values().collect();
    result.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));

    Ok(MessageListResponse {
        messages: result,
        next_cursor,
    })
}

pub async fn insert_message(pool: &SqlitePool, message: &NewMessage) -> Result<Message, AppError> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let id = uuid::Uuid::now_v7().to_string();

    let created_at = chrono::DateTime::from_timestamp_millis(now_ms)
        .unwrap()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    let mut tx = pool.begin().await?;

    sqlx::query("INSERT INTO messages (id, kind, text, created_at_ms) VALUES (?1, ?2, ?3, ?4)")
        .bind(&id)
        .bind(&message.kind)
        .bind(&message.text)
        .bind(now_ms)
        .execute(&mut *tx)
        .await?;

    let attachment_out = if let Some(ref att) = message.attachment {
        let att_id = uuid::Uuid::now_v7().to_string();
        sqlx::query(
            r#"
            INSERT INTO attachments (id, message_id, original_name, mime_type, size_bytes, sha256, storage_name, created_at_ms)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
        )
        .bind(&att_id)
        .bind(&id)
        .bind(&att.original_name)
        .bind(&att.mime_type)
        .bind(att.size_bytes)
        .bind(&att.sha256)
        .bind(&att.storage_name)
        .bind(now_ms)
        .execute(&mut *tx)
        .await?;

        sqlx::query("INSERT INTO messages_fts (message_id, text, filename) VALUES (?1, ?2, ?3)")
            .bind(&id)
            .bind(message.text.clone().unwrap_or_default())
            .bind(&att.original_name)
            .execute(&mut *tx)
            .await?;

        Some(Attachment {
            content_url: format!("/api/v1/files/{att_id}/content"),
            download_url: format!("/api/v1/files/{att_id}/download"),
            id: att_id,
            filename: att.original_name.clone(),
            mime_type: att.mime_type.clone(),
            size: att.size_bytes,
            sha256: att.sha256.clone(),
        })
    } else {
        sqlx::query("INSERT INTO messages_fts (message_id, text, filename) VALUES (?1, ?2, ?3)")
            .bind(&id)
            .bind(message.text.clone().unwrap_or_default())
            .bind("")
            .execute(&mut *tx)
            .await?;
        None
    };

    tx.commit().await?;

    Ok(Message {
        id,
        kind: message.kind.clone(),
        text: message.text.clone(),
        created_at,
        attachment: attachment_out,
    })
}

pub async fn get_message(pool: &SqlitePool, id: &str) -> Result<Option<Message>, AppError> {
    let rows = sqlx::query_as::<_, MessageRow>(
        r#"
        SELECT m.id, m.kind, m.text, m.created_at_ms,
               a.id as a_id, a.original_name as a_filename, a.mime_type as a_mime_type,
               a.size_bytes as a_size, a.sha256 as a_sha256, a.storage_name as a_storage_name,
               a.created_at_ms as a_created_at_ms
        FROM messages m
        LEFT JOIN attachments a ON a.message_id = m.id
        WHERE m.id = ?1
        "#,
    )
    .bind(id)
    .fetch_all(pool)
    .await?;

    let grouped = group_messages(&rows);
    Ok(grouped.into_values().next())
}

// Deletes the message (+ attachment row via cascade) and its FTS entry.
// Returns the storage name of the deleted attachment so the caller can
// clean up the physical file.
pub async fn delete_message(pool: &SqlitePool, id: &str) -> Result<Option<String>, AppError> {
    let mut tx = pool.begin().await?;

    let attachment = sqlx::query_as::<_, AttachmentRow>(
        "SELECT id, storage_name FROM attachments WHERE message_id = ?1",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM messages WHERE id = ?1")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM messages_fts WHERE message_id = ?1")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(attachment.map(|a| a.storage_name))
}

#[derive(Debug, Serialize)]
pub struct MessageContextResponse {
    /// Messages ordered old → new, target message included.
    pub messages: Vec<Message>,
    /// Cursor for loading older messages, if any exist below the window.
    #[serde(rename = "nextCursor")]
    pub next_cursor: Option<String>,
}

// Returns up to `limit` messages centered on `id`, preserving real time
// order (old → new). Used by the frontend to jump to a search result
// without breaking chronological ordering.
pub async fn get_message_context(
    pool: &SqlitePool,
    id: &str,
    limit: i64,
) -> Result<Option<MessageContextResponse>, AppError> {
    let limit = limit.clamp(1, 100);
    let target = sqlx::query_scalar::<_, i64>("SELECT created_at_ms FROM messages WHERE id = ?1")
        .bind(id)
        .fetch_optional(pool)
        .await?;

    let Some(target_ms) = target else {
        return Ok(None);
    };

    let half = (limit / 2).max(1);

    // Total order is (created_at_ms, id): UUIDv7 ties at the same
    // millisecond are resolved by the monotonic id, so messages created
    // in the same millisecond are never missed or reordered.
    let newer = sqlx::query_as::<_, MessageRow>(
        r#"
        SELECT m.id, m.kind, m.text, m.created_at_ms,
               a.id as a_id, a.original_name as a_filename, a.mime_type as a_mime_type,
               a.size_bytes as a_size, a.sha256 as a_sha256, a.storage_name as a_storage_name,
               a.created_at_ms as a_created_at_ms
        FROM messages m
        LEFT JOIN attachments a ON a.message_id = m.id
        WHERE m.created_at_ms > ?1
           OR (m.created_at_ms = ?1 AND m.id > ?2)
        ORDER BY m.created_at_ms ASC, m.id ASC
        LIMIT ?3
        "#,
    )
    .bind(target_ms)
    .bind(id)
    .bind(half)
    .fetch_all(pool)
    .await?;

    let older_limit = (limit - newer.len() as i64).max(1);
    let mut rows = sqlx::query_as::<_, MessageRow>(
        r#"
        SELECT m.id, m.kind, m.text, m.created_at_ms,
               a.id as a_id, a.original_name as a_filename, a.mime_type as a_mime_type,
               a.size_bytes as a_size, a.sha256 as a_sha256, a.storage_name as a_storage_name,
               a.created_at_ms as a_created_at_ms
        FROM messages m
        LEFT JOIN attachments a ON a.message_id = m.id
        WHERE m.created_at_ms < ?1
           OR (m.created_at_ms = ?1 AND m.id <= ?2)
        ORDER BY m.created_at_ms DESC, m.id DESC
        LIMIT ?3
        "#,
    )
    .bind(target_ms)
    .bind(id)
    .bind(older_limit)
    .fetch_all(pool)
    .await?;

    // Merge the newer half into the window before ordering.
    rows.extend(newer);

    // rows is currently newest→oldest; reorder old→new before grouping.
    rows.sort_by(|a, b| a.created_at_ms.cmp(&b.created_at_ms).then(a.id.cmp(&b.id)));

    let oldest = rows.first();
    let has_older = if let Some(oldest) = oldest {
        sqlx::query_scalar::<_, i64>(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM messages
                WHERE created_at_ms < ?1
                   OR (created_at_ms = ?1 AND id < ?2)
            )
            "#,
        )
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

    let grouped = group_messages(&rows);
    let mut messages: Vec<Message> = grouped.into_values().collect();
    messages.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));

    Ok(Some(MessageContextResponse {
        messages,
        next_cursor,
    }))
}

#[derive(Debug, sqlx::FromRow)]
pub struct MessageRow {
    id: String,
    kind: String,
    text: Option<String>,
    created_at_ms: i64,
    a_id: Option<String>,
    a_filename: Option<String>,
    a_mime_type: Option<String>,
    a_size: Option<i64>,
    a_sha256: Option<String>,
    a_storage_name: Option<String>,
    a_created_at_ms: Option<i64>,
}

#[derive(Debug, sqlx::FromRow)]
struct AttachmentRow {
    id: String,
    storage_name: String,
}

pub fn group_messages(rows: &[MessageRow]) -> std::collections::HashMap<String, Message> {
    let mut map: std::collections::HashMap<String, Message> = std::collections::HashMap::new();
    for row in rows {
        let entry = map.entry(row.id.clone()).or_insert_with(|| {
            let created_at = chrono::DateTime::from_timestamp_millis(row.created_at_ms)
                .unwrap()
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string();
            Message {
                id: row.id.clone(),
                kind: row.kind.clone(),
                text: row.text.clone(),
                created_at,
                attachment: None,
            }
        });
        if let (Some(a_id), Some(a_filename), Some(a_size), Some(a_sha256), Some(_a_storage_name)) = (
            row.a_id.as_ref(),
            row.a_filename.as_ref(),
            row.a_size,
            row.a_sha256.as_ref(),
            row.a_storage_name.as_ref(),
        ) {
            entry.attachment = Some(Attachment {
                id: a_id.clone(),
                filename: a_filename.clone(),
                mime_type: row.a_mime_type.clone(),
                size: a_size,
                sha256: a_sha256.clone(),
                content_url: format!("/api/v1/files/{a_id}/content"),
                download_url: format!("/api/v1/files/{a_id}/download"),
            });
        }
    }
    map
}

pub struct NewAttachment {
    pub original_name: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub sha256: String,
    pub storage_name: String,
}

pub struct NewMessage {
    pub kind: String,
    pub text: Option<String>,
    pub attachment: Option<NewAttachment>,
}

pub async fn get_storage_stats(pool: &SqlitePool) -> Result<serde_json::Value, AppError> {
    let total = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT COALESCE(SUM(size_bytes), 0) FROM attachments",
    )
    .fetch_one(pool)
    .await?
    .unwrap_or(0);

    let by_type = sqlx::query_as::<_, (String, i64)>(
        r#"
        SELECT COALESCE(m.kind, 'unknown') as kind, COALESCE(SUM(a.size_bytes), 0) as total
        FROM attachments a
        JOIN messages m ON m.id = a.message_id
        GROUP BY m.kind
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut breakdown = serde_json::Map::new();
    let mut images = 0i64;
    let mut videos = 0i64;
    let mut audio = 0i64;
    let mut files = 0i64;

    for (kind, size) in &by_type {
        match kind.as_str() {
            "image" => images += size,
            "video" => videos += size,
            "audio" => audio += size,
            _ => files += size,
        }
    }

    breakdown.insert("total".to_string(), serde_json::json!(total));
    breakdown.insert("images".to_string(), serde_json::json!(images));
    breakdown.insert("videos".to_string(), serde_json::json!(videos));
    breakdown.insert("audio".to_string(), serde_json::json!(audio));
    breakdown.insert("files".to_string(), serde_json::json!(files));

    Ok(serde_json::Value::Object(breakdown))
}
