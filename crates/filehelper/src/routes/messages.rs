use crate::db;
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
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

pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<axum::http::StatusCode, AppError> {
    db::delete_message(&state.db, &id).await?;

    let _ = state.broadcast.send(crate::state::BroadcastEvent {
        event_type: "message.deleted".to_string(),
        message: None,
        message_id: Some(id),
    });

    Ok(axum::http::StatusCode::NO_CONTENT)
}