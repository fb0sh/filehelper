use crate::files;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::Response;

pub async fn content(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, crate::error::AppError> {
    files::handle_content(State(state), Path(id), headers).await
}

pub async fn download(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, crate::error::AppError> {
    files::handle_download(State(state), Path(id), headers).await
}
