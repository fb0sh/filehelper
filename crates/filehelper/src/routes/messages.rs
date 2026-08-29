use crate::config::MAX_BATCH_IDS;
use crate::db;
use crate::error::AppError;
use crate::state::AppState;
use axum::Json;
use axum::extract::{Path, Query, State};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct ListQuery {
    pub before: Option<String>,
    pub limit: Option<i64>,
}

pub async fn list(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
    Query(query): Query<ListQuery>,
) -> Result<Json<db::MessageListResponse>, AppError> {
    let limit = query.limit.unwrap_or(50);
    let result = db::list_messages(&state.db, &auth.space_id, query.before, limit).await?;
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct CreateMessage {
    /// Encrypted message payload (opaque to the server).
    pub payload: String,
}

pub async fn create(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
    Json(body): Json<CreateMessage>,
) -> Result<Json<db::EncryptedMessage>, AppError> {
    if body.payload.is_empty() || body.payload.len() > crate::config::MAX_MESSAGE_PAYLOAD {
        return Err(AppError::PayloadTooLarge);
    }
    let message = db::insert_message(&state.db, &auth.space_id, &body.payload, None).await?;
    crate::files::upload::publish_message_created(&state, &auth.space_id, &message);
    Ok(Json(message))
}

#[derive(Deserialize)]
pub struct ContextQuery {
    pub limit: Option<i64>,
}

pub async fn context(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
    Path(id): Path<String>,
    Query(query): Query<ContextQuery>,
) -> Result<Json<db::MessageContextResponse>, AppError> {
    let ctx = db::get_message_context(&state.db, &auth.space_id, &id, query.limit.unwrap_or(50))
        .await?
        .ok_or(AppError::MessageNotFound)?;
    Ok(Json(ctx))
}

pub async fn delete(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
    Path(id): Path<String>,
) -> Result<axum::http::StatusCode, AppError> {
    let ids = vec![id];
    let storage_names = db::delete_messages(&state.db, &auth.space_id, &ids).await?;
    cleanup_files(&state, &storage_names).await;
    crate::files::upload::publish_messages_deleted(&state, &auth.space_id, &ids);
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct BatchDelete {
    pub ids: Vec<String>,
}

/// POST /messages/batch-delete — one transaction, one broadcast.
/// Ids from other spaces are treated as absent and never deleted.
pub async fn batch_delete(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
    Json(body): Json<BatchDelete>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.ids.is_empty() || body.ids.len() > MAX_BATCH_IDS {
        return Err(AppError::BadRequest);
    }
    let storage_names = db::delete_messages(&state.db, &auth.space_id, &body.ids).await?;
    cleanup_files(&state, &storage_names).await;
    crate::files::upload::publish_messages_deleted(&state, &auth.space_id, &body.ids);
    Ok(Json(serde_json::json!({ "deleted": body.ids.len() })))
}

pub async fn get(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
    Path(id): Path<String>,
) -> Result<Json<db::EncryptedMessage>, AppError> {
    let message = db::get_message(&state.db, &auth.space_id, &id)
        .await?
        .ok_or(AppError::MessageNotFound)?;
    Ok(Json(message))
}

/// Clear the current space only (Settings → Storage → Clear All Data).
/// The space auth record is kept so the same CODE re-enters an empty
/// space; other spaces are untouched.
pub async fn clear_all(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
) -> Result<Json<serde_json::Value>, AppError> {
    let storage_names = db::clear_space(&state.db, &auth.space_id).await?;
    cleanup_files(&state, &storage_names).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Move deleted files to trash then unlink in the background; the
/// startup GC sweeps leftovers.
async fn cleanup_files(state: &AppState, storage_names: &[String]) {
    for name in storage_names {
        let files_dir = state.config.files_dir.clone();
        let trash_dir = state.config.trash_dir.clone();
        let name = name.clone();
        match crate::files::storage::move_to_trash(&files_dir, &trash_dir, &name).await {
            Ok(_) => {
                tokio::spawn(async move {
                    if let Err(e) = tokio::fs::remove_file(trash_dir.join(&name)).await {
                        tracing::warn!("Failed to unlink trashed file {name}: {e}");
                    }
                });
            }
            Err(e) => {
                tracing::error!(
                    "Failed to move deleted file {name} to trash: {e}; startup GC will retry"
                );
            }
        }
    }
}
