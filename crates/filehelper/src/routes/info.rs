use crate::db;
use crate::error::AppError;
use crate::state::AppState;
use axum::Json;
use axum::extract::State;

pub async fn info(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "name": state.config.name,
        "version": env!("CARGO_PKG_VERSION"),
        "instanceId": state.config.instance_id,
        "cryptoVersion": state.config.crypto_version,
        "maxUploadSize": state.config.max_upload_size,
    }))
}

/// Storage stats for the CURRENT space only (Settings → Storage).
pub async fn storage(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
) -> Result<Json<serde_json::Value>, AppError> {
    let stats = db::get_storage_stats(&state.db, &auth.space_id).await?;
    Ok(Json(stats))
}
