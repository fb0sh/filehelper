use crate::files;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::response::Response;

pub async fn download(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
    Path(id): Path<String>,
) -> Result<Response, crate::error::AppError> {
    files::download::handle_download(State(state), auth, Path(id)).await
}
