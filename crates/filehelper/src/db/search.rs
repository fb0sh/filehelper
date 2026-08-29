use crate::error::AppError;
use sqlx::SqlitePool;

// Build a safe FTS5 MATCH expression from arbitrary user input.
// Keeps only alphanumeric characters (unicode-aware, so CJK survives),
// then quotes every token as a phrase so FTS keywords (`OR`, `AND`,
// `NEAR`, `NOT`) and syntax characters (`"`, `(`, `)`, `*`, `-`, ...)
// can never change query semantics or cause a syntax error.
fn sanitize_fts_query(input: &str) -> String {
    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    for ch in input.chars() {
        if ch.is_alphanumeric() {
            current.push(ch);
        } else if !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
        .iter()
        .map(|t| format!("\"{t}\""))
        .collect::<Vec<_>>()
        .join(" ")
}

pub async fn search_messages(
    pool: &SqlitePool,
    query: &str,
    limit: i64,
) -> Result<Vec<crate::db::Message>, AppError> {
    let safe_query = sanitize_fts_query(query);
    if safe_query.is_empty() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query_as::<_, crate::db::messages::MessageRow>(
        r#"
        SELECT m.id, m.kind, m.text, m.created_at_ms,
               a.id as a_id, a.original_name as a_filename, a.mime_type as a_mime_type,
               a.size_bytes as a_size, a.sha256 as a_sha256, a.storage_name as a_storage_name,
               a.created_at_ms as a_created_at_ms
        FROM messages_fts fts
        JOIN messages m ON m.id = fts.message_id
        LEFT JOIN attachments a ON a.message_id = m.id
        WHERE messages_fts MATCH ?1
        ORDER BY m.created_at_ms DESC
        LIMIT ?2
        "#,
    )
    .bind(safe_query)
    .bind(limit.clamp(1, 100))
    .fetch_all(pool)
    .await?;

    let grouped = crate::db::messages::group_messages(&rows);
    let mut result: Vec<_> = grouped.into_values().collect();
    result.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::sanitize_fts_query;

    #[test]
    fn strips_fts_syntax_characters() {
        assert_eq!(sanitize_fts_query("hello"), "\"hello\"");
        assert_eq!(sanitize_fts_query("\"hello\""), "\"hello\"");
        // `OR` must become a literal term, not the FTS operator.
        assert_eq!(sanitize_fts_query("(a OR b)"), "\"a\" \"OR\" \"b\"");
        assert_eq!(sanitize_fts_query("file*"), "\"file\"");
        assert_eq!(sanitize_fts_query("a-b"), "\"a\" \"b\"");
        assert_eq!(sanitize_fts_query("NEAR(a b)"), "\"NEAR\" \"a\" \"b\"");
    }

    #[test]
    fn keeps_cjk_characters() {
        assert_eq!(sanitize_fts_query("文件传输"), "\"文件传输\"");
        assert_eq!(sanitize_fts_query("文件 助手"), "\"文件\" \"助手\"");
    }

    #[test]
    fn empty_input_yields_empty_query() {
        assert_eq!(sanitize_fts_query(""), "");
        assert_eq!(sanitize_fts_query("\"*()-\""), "");
    }
}
