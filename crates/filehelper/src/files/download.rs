use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::Response;
use tokio_util::io::ReaderStream;

fn is_safe_inline(mime: &str) -> bool {
    matches!(
        mime,
        "image/jpeg"
            | "image/png"
            | "image/webp"
            | "image/gif"
            | "image/svg+xml"
            | "video/mp4"
            | "video/webm"
            | "video/ogg"
            | "audio/mpeg"
            | "audio/ogg"
            | "audio/wav"
            | "audio/webm"
            | "application/pdf"
    )
}

pub async fn handle_content(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    serve_file(&state, &id, false, headers).await
}

pub async fn handle_download(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    serve_file(&state, &id, true, headers).await
}

async fn serve_file(
    state: &AppState,
    id: &str,
    force_download: bool,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let att = crate::db::attachments::get_attachment(&state.db, id)
        .await?
        .ok_or(AppError::FileNotFound)?;

    let file_path = state.config.files_dir.join(&att.storage_name);
    let file = tokio::fs::File::open(&file_path).await?;
    let metadata = file.metadata().await?;
    let file_size = metadata.len();

    let mime = att.mime_type.as_deref().unwrap_or("application/octet-stream");

    // Handle range requests
    if let Some(range_header) = headers.get("range") {
        let range_str = range_header.to_str().unwrap_or("");
        if let Some(range) = parse_range(range_str, file_size) {
            let mut buf = vec![0u8; (range.end - range.start + 1) as usize];
            let mut f = tokio::fs::File::open(&file_path).await?;
            tokio::io::AsyncSeekExt::seek(&mut f, std::io::SeekFrom::Start(range.start)).await?;
            tokio::io::AsyncReadExt::read_exact(&mut f, &mut buf).await?;

            let content_range = format!(
                "bytes {}-{}/{}",
                range.start,
                range.end,
                file_size
            );

            let mut builder = Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, mime)
                .header(header::CONTENT_RANGE, content_range)
                .header(header::CONTENT_LENGTH, buf.len().to_string())
                .header(header::ACCEPT_RANGES, "bytes");

            if force_download || !is_safe_inline(mime) {
                let filename = percent_encode(&att.original_name);
                builder = builder.header(
                    header::CONTENT_DISPOSITION,
                    format!("attachment; filename*=UTF-8''{filename}"),
                );
            }

            return Ok(builder.body(axum::body::Body::from(buf)).unwrap());
        }
    }

    let stream = ReaderStream::new(file);
    let body = axum::body::Body::from_stream(stream);

    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, file_size.to_string())
        .header("X-Content-Type-Options", "nosniff");

    if force_download || !is_safe_inline(mime) {
        let filename = percent_encode(&att.original_name);
        builder = builder.header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename*=UTF-8''{filename}"),
        );
    } else {
        builder = builder.header(header::CONTENT_DISPOSITION, "inline");
    }

    Ok(builder.body(body).unwrap())
}

struct ByteRange {
    start: u64,
    end: u64,
}

fn parse_range(range_str: &str, file_size: u64) -> Option<ByteRange> {
    let range_str = range_str.strip_prefix("bytes=")?;
    let parts: Vec<&str> = range_str.split('-').collect();
    if parts.len() != 2 {
        return None;
    }

    let start: u64 = if parts[0].is_empty() {
        let suffix: u64 = parts[1].parse().ok()?;
        file_size.saturating_sub(suffix)
    } else {
        parts[0].parse().ok()?
    };

    let end: u64 = if parts[1].is_empty() {
        file_size - 1
    } else {
        parts[1].parse().ok()?
    };

    if start > end || end >= file_size {
        return None;
    }

    Some(ByteRange { start, end })
}

fn percent_encode(input: &str) -> String {
    let mut result = String::new();
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(byte as char);
            }
            _ => {
                result.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    result
}