use crate::db;
use crate::state::AppState;
use axum::Json;
use axum::extract::State;

pub async fn info(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "name": state.config.name,
        "version": "0.1.0",
        "authEnabled": state.config.auth_enabled,
        "maxUploadSize": state.config.max_upload_size,
    }))
}

pub async fn storage(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, crate::error::AppError> {
    let stats = db::get_storage_stats(&state.db).await?;
    Ok(Json(stats))
}
