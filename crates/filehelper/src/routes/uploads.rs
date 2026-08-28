use crate::files;
use crate::state::AppState;
use axum::extract::{Multipart, State};
use axum::response::Response;

pub async fn upload(
    State(state): State<AppState>,
    multipart: Multipart,
) -> Result<Response, crate::error::AppError> {
    files::handle_upload(State(state), multipart).await
}