use crate::error::AppError;
use crate::state::AppState;
use axum::body::Body;
use axum::extract::{Multipart, State};
use axum::http::{header, StatusCode};
use axum::response::Response;
use futures_util::{StreamExt, TryStreamExt};
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

pub async fn handle_upload(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Response, AppError> {
    let tmp_dir = state.config.tmp_dir.clone();
    let files_dir = state.config.files_dir.clone();
    let max_size = state.config.max_upload_size;
    let pool = state.db.clone();

    let mut original_name = String::new();
    let mut mime_type: Option<String> = None;
    let tmp_path = tmp_dir.join(format!("{}.part", uuid::Uuid::now_v7()));
    let mut file = tokio::fs::File::create(&tmp_path).await?;
    let mut hasher = Sha256::new();
    let mut total_bytes: i64 = 0;

    while let Some(field) = multipart.next_field().await? {
        let name = field.name().unwrap_or("").to_string();
        if name == "file" {
            original_name = field.file_name().unwrap_or("unknown").to_string();
            mime_type = field.content_type().map(|s| s.to_string());

            let mut stream = field.into_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk?;
                total_bytes += chunk.len() as i64;
                if total_bytes > max_size as i64 {
                    drop(file);
                    let _ = tokio::fs::remove_file(&tmp_path).await;
                    return Err(AppError::UploadTooLarge);
                }
                hasher.update(&chunk);
                file.write_all(&chunk).await?;
            }
        }
    }

    file.flush().await?;
    let hash = format!("{:x}", hasher.finalize());
    let storage_name = uuid::Uuid::now_v7().to_string();
    let final_path = files_dir.join(&storage_name);

    tokio::fs::rename(&tmp_path, &final_path).await?;

    let message = crate::db::insert_message(
        &pool,
        &crate::db::NewMessage {
            kind: classify_kind(mime_type.as_deref()),
            text: None,
            attachment: Some(crate::db::NewAttachment {
                original_name,
                mime_type,
                size_bytes: total_bytes,
                sha256: hash,
                storage_name,
            }),
        },
    )
    .await?;

    let _ = state.broadcast.send(crate::state::BroadcastEvent {
        event_type: "message.created".to_string(),
        message: Some(serde_json::to_value(&message).unwrap()),
        message_id: None,
    });

    let body = serde_json::to_string(&message).unwrap();
    Ok(Response::builder()
        .status(StatusCode::CREATED)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap())
}

fn classify_kind(mime: Option<&str>) -> String {
    match mime {
        Some(m) if m.starts_with("image/") => "image".to_string(),
        Some(m) if m.starts_with("video/") => "video".to_string(),
        Some(m) if m.starts_with("audio/") => "audio".to_string(),
        _ => "document".to_string(),
    }
}