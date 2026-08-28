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
    let limit = limit.min(100).max(1);
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
            ORDER BY m.created_at_ms DESC
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
            ORDER BY m.created_at_ms DESC
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
    result.sort_by_key(|m| std::cmp::Reverse(m.created_at.clone()));

    Ok(MessageListResponse {
        messages: result,
        next_cursor,
    })
}

pub async fn insert_message(
    pool: &SqlitePool,
    message: &NewMessage,
) -> Result<Message, AppError> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let id = uuid::Uuid::now_v7().to_string();

    let created_at = chrono::DateTime::from_timestamp_millis(now_ms)
        .unwrap()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    sqlx::query(
        "INSERT INTO messages (id, kind, text, created_at_ms) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(&id)
    .bind(&message.kind)
    .bind(&message.text)
    .bind(now_ms)
    .execute(pool)
    .await?;

    if let Some(ref att) = message.attachment {
        let att_id = uuid::Uuid::now_v7().to_string();
        let att_id_clone = att_id.clone();
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
        .execute(pool)
        .await?;

        Ok(Message {
            id,
            kind: message.kind.clone(),
            text: message.text.clone(),
            created_at,
            attachment: Some(Attachment {
                id: att_id,
                filename: att.original_name.clone(),
                mime_type: att.mime_type.clone(),
                size: att.size_bytes,
                sha256: att.sha256.clone(),
                content_url: format!("/api/v1/files/{att_id_clone}/content"),
                download_url: format!("/api/v1/files/{att_id_clone}/download"),
            }),
        })
    } else {
        Ok(Message {
            id,
            kind: message.kind.clone(),
            text: message.text.clone(),
            created_at,
            attachment: None,
        })
    }
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

pub async fn delete_message(pool: &SqlitePool, id: &str) -> Result<(), AppError> {
    // Get attachment info before deleting
    let attachment = sqlx::query_as::<_, AttachmentRow>(
        "SELECT id, storage_name FROM attachments WHERE message_id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    // Delete message (cascade deletes attachment)
    sqlx::query("DELETE FROM messages WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;

    // Return the storage name so the caller can clean up the file
    if let Some(att) = attachment {
        tracing::info!("Orphaned file: {}", att.storage_name);
    }

    Ok(())
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
        if let (Some(a_id), Some(a_filename), Some(a_size), Some(a_sha256), Some(_a_storage_name)) =
            (
                row.a_id.as_ref(),
                row.a_filename.as_ref(),
                row.a_size,
                row.a_sha256.as_ref(),
                row.a_storage_name.as_ref(),
            )
        {
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

pub async fn get_storage_stats(
    pool: &SqlitePool,
) -> Result<serde_json::Value, AppError> {
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