use crate::files;
use crate::state::AppState;
use axum::body::Body;
use axum::extract::{Path, Request, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde::Deserialize;

pub async fn init(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
) -> Result<axum::Json<files::upload::InitUploadResponse>, crate::error::AppError> {
    files::upload::init_upload(State(state), auth).await
}

pub async fn chunk(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
    Path((upload_id, index)): Path<(String, u64)>,
    req: Request<Body>,
) -> Result<StatusCode, crate::error::AppError> {
    files::upload::upload_chunk(State(state), auth, Path((upload_id, index)), req).await
}

#[derive(Deserialize)]
pub struct CompleteBody {
    pub payload: String,
}

pub async fn complete(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
    Path(upload_id): Path<String>,
    axum::Json(body): axum::Json<CompleteBody>,
) -> Result<Response, crate::error::AppError> {
    files::upload::complete_upload(
        State(state),
        auth,
        Path(upload_id),
        axum::Json(files::upload::CompleteUpload {
            payload: body.payload,
        }),
    )
    .await
}

pub async fn cancel(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
    Path(upload_id): Path<String>,
) -> Result<StatusCode, crate::error::AppError> {
    files::upload::cancel_upload(State(state), auth, Path(upload_id)).await
}
