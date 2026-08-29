use crate::error::AppError;
use crate::state::AppState;
use axum::body::Body;
use axum::extract::{Multipart, State};
use axum::http::{StatusCode, header};
use axum::response::Response;
use futures_util::{StreamExt, TryStreamExt};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tokio::io::AsyncWriteExt;

pub async fn handle_upload(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Response, AppError> {
    let tmp_dir = state.config.tmp_dir.clone();
    let files_dir = state.config.files_dir.clone();
    let max_size = state.config.max_upload_size;
    let pool = state.db.clone();

    let mut original_name: Option<String> = None;
    let mut mime_type: Option<String> = None;
    let mut tmp_path: Option<PathBuf> = None;
    let mut file: Option<tokio::fs::File> = None;
    let mut hasher = Sha256::new();
    let mut total_bytes: i64 = 0;
    let mut file_fields = 0usize;

    let read_result: Result<(), AppError> = async {
        while let Some(field) = multipart.next_field().await? {
            if field.name() != Some("file") {
                continue;
            }
            file_fields += 1;
            if file_fields > 1 {
                return Err(AppError::InvalidUpload);
            }
            original_name = Some(field.file_name().unwrap_or("unknown").to_string());
            mime_type = field.content_type().map(|s| s.to_string());

            let path = tmp_dir.join(format!("{}.part", uuid::Uuid::now_v7()));
            let created = tokio::fs::File::create(&path).await?;
            tmp_path = Some(path);
            file = Some(created);

            let mut stream = field.into_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk?;
                total_bytes += chunk.len() as i64;
                if total_bytes > max_size as i64 {
                    return Err(AppError::UploadTooLarge);
                }
                hasher.update(&chunk);
                file.as_mut()
                    .expect("tmp file created before streaming")
                    .write_all(&chunk)
                    .await?;
            }
        }
        Ok(())
    }
    .await;

    if let Err(err) = read_result {
        if let Some(path) = &tmp_path {
            let _ = tokio::fs::remove_file(path).await;
        }
        return Err(err);
    }

    // Exactly one "file" field is required.
    if file_fields != 1 {
        if let Some(path) = &tmp_path {
            let _ = tokio::fs::remove_file(path).await;
        }
        return Err(AppError::InvalidUpload);
    }

    let mut written = file.expect("file field was read");
    written.flush().await?;
    drop(written);

    let hash = format!("{:x}", hasher.finalize());
    let storage_name = uuid::Uuid::now_v7().to_string();
    let final_path = files_dir.join(&storage_name);
    let tmp_path = tmp_path.expect("file field was read");

    tokio::fs::rename(&tmp_path, &final_path).await?;

    match crate::db::insert_message(
        &pool,
        &crate::db::NewMessage {
            kind: classify_kind(mime_type.as_deref()),
            text: None,
            attachment: Some(crate::db::NewAttachment {
                original_name: original_name.unwrap_or_else(|| "unknown".to_string()),
                mime_type,
                size_bytes: total_bytes,
                sha256: hash,
                storage_name,
            }),
        },
    )
    .await
    {
        Ok(message) => {
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
        // DB insert failed after the rename: roll back the stored file
        // so it doesn't become an orphan.
        Err(err) => {
            if let Err(e) = tokio::fs::remove_file(&final_path).await {
                tracing::error!(
                    "Failed to remove stored file {} after DB failure: {e}",
                    final_path.display()
                );
            }
            Err(err)
        }
    }
}

fn classify_kind(mime: Option<&str>) -> String {
    match mime {
        Some(m) if m.starts_with("image/") => "image".to_string(),
        Some(m) if m.starts_with("video/") => "video".to_string(),
        Some(m) if m.starts_with("audio/") => "audio".to_string(),
        _ => "document".to_string(),
    }
}
