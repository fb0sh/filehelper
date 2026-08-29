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
    Query(query): Query<ListQuery>,
) -> Result<Json<db::MessageListResponse>, AppError> {
    let limit = query.limit.unwrap_or(50);
    let result = db::list_messages(&state.db, query.before, limit).await?;
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct CreateMessage {
    pub text: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateMessage>,
) -> Result<Json<db::Message>, AppError> {
    let text = body.text.as_deref().unwrap_or("").trim();
    if text.is_empty() {
        return Err(AppError::InvalidUpload); // reuse as bad request
    }
    let message = db::insert_message(
        &state.db,
        &db::NewMessage {
            kind: "text".to_string(),
            text: Some(text.to_string()),
            attachment: None,
        },
    )
    .await?;

    let _ = state.broadcast.send(crate::state::BroadcastEvent {
        event_type: "message.created".to_string(),
        message: Some(serde_json::to_value(&message).unwrap()),
        message_id: None,
    });

    Ok(Json(message))
}

#[derive(Deserialize)]
pub struct ContextQuery {
    pub limit: Option<i64>,
}

pub async fn context(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<ContextQuery>,
) -> Result<Json<db::MessageContextResponse>, AppError> {
    let ctx = db::get_message_context(&state.db, &id, query.limit.unwrap_or(50))
        .await?
        .ok_or(AppError::MessageNotFound)?;
    Ok(Json(ctx))
}

pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<axum::http::StatusCode, AppError> {
    let storage_name = db::delete_message(&state.db, &id).await?;

    // Clean up the physical file: atomic rename to trash first, then
    // unlink from trash in the background. If anything fails, startup
    // GC sweeps it later.
    if let Some(name) = storage_name {
        let files_dir = state.config.files_dir.clone();
        let trash_dir = state.config.trash_dir.clone();
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

    let _ = state.broadcast.send(crate::state::BroadcastEvent {
        event_type: "message.deleted".to_string(),
        message: None,
        message_id: Some(id),
    });

    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub async fn get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<db::Message>, AppError> {
    let message = db::get_message(&state.db, &id)
        .await?
        .ok_or(AppError::MessageNotFound)?;
    Ok(Json(message))
}
