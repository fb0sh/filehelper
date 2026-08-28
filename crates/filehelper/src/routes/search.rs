use crate::db;
use crate::error::AppError;
use crate::state::AppState;
use axum::Json;
use axum::extract::{Query, State};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: String,
    pub limit: Option<i64>,
}

pub async fn search(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let results =
        db::search::search_messages(&state.db, &query.q, query.limit.unwrap_or(50)).await?;
    Ok(Json(serde_json::json!({ "results": results })))
}
