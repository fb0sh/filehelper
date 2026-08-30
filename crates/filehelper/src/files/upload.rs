use crate::config::{AEAD_TAG, FILE_CHUNK_SIZE, MAX_MESSAGE_PAYLOAD};
use crate::db::{self, NewAttachment};
use crate::error::AppError;
use crate::state::AppState;
use axum::body::Body;
use axum::extract::{Path, Request, State};
use axum::http::{StatusCode, header};
use axum::response::Response;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tokio::io::AsyncWriteExt;

/// In-memory single-process upload registry. Each upload is sequential
/// (chunks arrive in order), so state is tiny. A server restart loses
/// the registry; startup GC removes the stale .part files.
#[derive(Default)]
pub struct UploadRegistry {
    inner: Mutex<HashMap<String, UploadState>>,
}

#[derive(Debug)]
pub struct UploadState {
    pub upload_id: String,
    pub attachment_id: String,
    pub space_id: String,
    pub expected_chunk: u64,
    pub ciphertext_bytes: u64,
    pub part_path: PathBuf,
}

impl UploadRegistry {
    pub fn insert(&self, state: UploadState) {
        self.inner
            .lock()
            .unwrap()
            .insert(state.upload_id.clone(), state);
    }

    pub fn take(&self, upload_id: &str) -> Option<UploadState> {
        self.inner.lock().unwrap().remove(upload_id)
    }

    /// Validate the incoming chunk: ownership, order, size cap. Returns
    /// the part path to append to and the current byte budget.
    pub fn begin_chunk(
        &self,
        upload_id: &str,
        space_id: &str,
        index: u64,
        max_ciphertext: u64,
    ) -> Result<(PathBuf, u64), AppError> {
        let mut map = self.inner.lock().unwrap();
        let state = map.get_mut(upload_id).ok_or(AppError::UploadNotFound)?;
        if state.space_id != space_id {
            return Err(AppError::UploadNotFound);
        }
        if index != state.expected_chunk {
            return Err(AppError::UploadChunkOrder);
        }
        if state.ciphertext_bytes >= max_ciphertext {
            return Err(AppError::UploadTooLarge);
        }
        let budget = max_ciphertext - state.ciphertext_bytes;
        Ok((state.part_path.clone(), budget))
    }

    pub fn finish_chunk(
        &self,
        upload_id: &str,
        space_id: &str,
        index: u64,
        added: u64,
    ) -> Result<(), AppError> {
        let mut map = self.inner.lock().unwrap();
        let state = map.get_mut(upload_id).ok_or(AppError::UploadNotFound)?;
        if state.space_id != space_id || index != state.expected_chunk {
            return Err(AppError::UploadChunkOrder);
        }
        if added > FILE_CHUNK_SIZE + AEAD_TAG {
            return Err(AppError::InvalidUpload);
        }
        state.ciphertext_bytes += added;
        state.expected_chunk += 1;
        Ok(())
    }

    pub fn get_attachment_id(&self, upload_id: &str, space_id: &str) -> Result<String, AppError> {
        let map = self.inner.lock().unwrap();
        let state = map.get(upload_id).ok_or(AppError::UploadNotFound)?;
        if state.space_id != space_id {
            return Err(AppError::UploadNotFound);
        }
        Ok(state.attachment_id.clone())
    }
}

#[derive(Deserialize, Serialize)]
pub struct InitUploadResponse {
    #[serde(rename = "uploadId")]
    pub upload_id: String,
    #[serde(rename = "attachmentId")]
    pub attachment_id: String,
}

/// POST /api/v1/uploads — create an upload for a file message.
pub async fn init_upload(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
) -> Result<axum::Json<InitUploadResponse>, AppError> {
    let upload_id = uuid::Uuid::now_v7().to_string();
    let attachment_id = uuid::Uuid::now_v7().to_string();
    let part_path = state.config.tmp_dir.join(format!("{upload_id}.part"));

    state.uploads.insert(UploadState {
        upload_id: upload_id.clone(),
        attachment_id: attachment_id.clone(),
        space_id: auth.space_id.clone(),
        expected_chunk: 0,
        ciphertext_bytes: 0,
        part_path,
    });

    Ok(axum::Json(InitUploadResponse {
        upload_id,
        attachment_id,
    }))
}

/// PUT /api/v1/uploads/:uploadId/chunks/:index — append one ciphertext
/// chunk. Sequential only; body is streamed straight to the .part file.
pub async fn upload_chunk(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
    Path((upload_id, index)): Path<(String, u64)>,
    req: Request<Body>,
) -> Result<StatusCode, AppError> {
    let max_ciphertext = state.max_ciphertext_size();
    let (part_path, budget) =
        state
            .uploads
            .begin_chunk(&upload_id, &auth.space_id, index, max_ciphertext)?;

    // Stream the body to disk with a hard cap (chunk size + tag). We
    // never buffer more than one bounded chunk; never the whole file.
    let mut body = req.into_body().into_data_stream();
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&part_path)
        .await?;

    let mut written: u64 = 0;
    let result: Result<(), AppError> = async {
        while let Some(chunk) = body.next().await {
            let chunk = chunk.map_err(|_| AppError::BadRequest)?;
            written += chunk.len() as u64;
            if written > budget || written > FILE_CHUNK_SIZE + AEAD_TAG {
                return Err(AppError::UploadTooLarge);
            }
            file.write_all(&chunk).await?;
        }
        Ok(())
    }
    .await;

    if let Err(err) = result {
        let _ = tokio::fs::remove_file(&part_path).await;
        state.uploads.take(&upload_id);
        return Err(err);
    }

    file.flush().await?;
    state
        .uploads
        .finish_chunk(&upload_id, &auth.space_id, index, written)?;

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct CompleteUpload {
    /// Encrypted file-message payload (opaque to the server).
    pub payload: String,
}

/// POST /api/v1/uploads/:uploadId/complete — finalize the file: rename
/// the .part into files/, insert message + attachment atomically, then
/// broadcast. Rolls the stored file back if the DB insert fails.
pub async fn complete_upload(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
    Path(upload_id): Path<String>,
    axum::Json(body): axum::Json<CompleteUpload>,
) -> Result<Response, AppError> {
    if body.payload.len() > MAX_MESSAGE_PAYLOAD {
        return Err(AppError::PayloadTooLarge);
    }
    if body.payload.is_empty() {
        return Err(AppError::BadRequest);
    }

    let upload = state
        .uploads
        .take(&upload_id)
        .ok_or(AppError::UploadNotFound)?;
    if upload.space_id != auth.space_id {
        return Err(AppError::UploadNotFound);
    }

    let storage_name = uuid::Uuid::now_v7().to_string();
    let final_path = state.config.files_dir.join(&storage_name);
    tokio::fs::rename(&upload.part_path, &final_path).await?;

    let message = match db::insert_message(
        &state.db,
        &auth.space_id,
        &body.payload,
        Some(NewAttachment {
            id: upload.attachment_id,
            storage_name,
            ciphertext_size: upload.ciphertext_bytes as i64,
        }),
    )
    .await
    {
        Ok(m) => m,
        Err(err) => {
            // DB insert failed after the rename: roll back the stored
            // file so it does not become an orphan.
            if let Err(e) = tokio::fs::remove_file(&final_path).await {
                tracing::error!(
                    "Failed to remove stored file {} after DB failure: {e}",
                    final_path.display()
                );
            }
            return Err(err);
        }
    };

    publish_message_created(&state, &auth.space_id, &message);

    let body_str = serde_json::to_string(&message).unwrap();
    Ok(Response::builder()
        .status(StatusCode::CREATED)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body_str))
        .unwrap())
}

/// DELETE /api/v1/uploads/:uploadId — abort: drop the .part and state.
pub async fn cancel_upload(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
    Path(upload_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let upload = state
        .uploads
        .take(&upload_id)
        .ok_or(AppError::UploadNotFound)?;
    if upload.space_id != auth.space_id {
        return Err(AppError::UploadNotFound);
    }
    let _ = tokio::fs::remove_file(&upload.part_path).await;
    Ok(StatusCode::NO_CONTENT)
}

pub fn publish_message_created(state: &AppState, space_id: &str, message: &db::EncryptedMessage) {
    let event = serde_json::json!({
        "type": "message.created",
        "message": message,
    });
    state.spaces.publish(space_id, event);
}

pub fn publish_messages_deleted(state: &AppState, space_id: &str, message_ids: &[String]) {
    let event = serde_json::json!({
        "type": "messages.deleted",
        "messageIds": message_ids,
    });
    state.spaces.publish(space_id, event);
}

/// Broadcast that the whole space was wiped (Settings → Clear All Data),
/// so every connected tab/device empties its UI immediately.
pub fn publish_space_cleared(state: &AppState, space_id: &str) {
    let event = serde_json::json!({ "type": "space.cleared" });
    state.spaces.publish(space_id, event);
}
