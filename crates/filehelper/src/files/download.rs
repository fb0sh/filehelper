use crate::db;
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::Response;
use tokio_util::io::ReaderStream;

/// GET /api/v1/files/:attachmentId/download — serve the ciphertext with
/// constant memory (ReaderStream). Scoped to the authenticated space:
/// another space's attachment id is indistinguishable from "not found".
///
/// The server never sees the plaintext, so it cannot provide a real
/// filename or MIME type — the client decrypts and names the file
/// locally.
pub async fn handle_download(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let att = db::attachments::get_attachment(&state.db, &auth.space_id, &id)
        .await?
        .ok_or(AppError::FileNotFound)?;

    let file_path = state.config.files_dir.join(&att.storage_name);
    let file = tokio::fs::File::open(&file_path).await?;
    let metadata = file.metadata().await?;
    let file_size = metadata.len();

    // Never buffer the whole file (or a whole Range) in memory.
    let stream = ReaderStream::new(file);
    let body = axum::body::Body::from_stream(stream);

    let builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_LENGTH, file_size.to_string())
        .header(header::CONTENT_DISPOSITION, "attachment")
        .header("X-Content-Type-Options", "nosniff");

    Ok(builder.body(body).unwrap())
}
