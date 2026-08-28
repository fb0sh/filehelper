use crate::error::AppError;
use sqlx::SqlitePool;

pub async fn search_messages(
    pool: &SqlitePool,
    query: &str,
    limit: i64,
) -> Result<Vec<crate::db::Message>, AppError> {
    let rows = sqlx::query_as::<_, crate::db::messages::MessageRow>(
        r#"
        SELECT m.id, m.kind, m.text, m.created_at_ms,
               a.id as a_id, a.original_name as a_filename, a.mime_type as a_mime_type,
               a.size_bytes as a_size, a.sha256 as a_sha256, a.storage_name as a_storage_name,
               a.created_at_ms as a_created_at_ms
        FROM messages_fts fts
        JOIN messages m ON m.rowid = fts.rowid
        LEFT JOIN attachments a ON a.message_id = m.id
        WHERE messages_fts MATCH ?1
        ORDER BY m.created_at_ms DESC
        LIMIT ?2
        "#,
    )
    .bind(query)
    .bind(limit.min(100))
    .fetch_all(pool)
    .await?;

    let grouped = crate::db::messages::group_messages(&rows);
    let mut result: Vec<_> = grouped.into_values().collect();
    result.sort_by_key(|m| std::cmp::Reverse(m.created_at.clone()));
    Ok(result)
}