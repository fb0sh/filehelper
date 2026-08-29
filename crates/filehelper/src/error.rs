#![allow(dead_code)]
use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Authentication required")]
    AuthRequired,
    #[error("Invalid credentials")]
    AuthFailed,
    #[error("No data found for this code")]
    SpaceNotFound,
    #[error("Space already exists")]
    SpaceExists,
    #[error("Session expired")]
    SessionExpired,
    #[error("Message not found")]
    MessageNotFound,
    #[error("File not found")]
    FileNotFound,
    #[error("Upload not found")]
    UploadNotFound,
    #[error("Upload chunks must arrive in order")]
    UploadChunkOrder,
    #[error("Upload too large")]
    UploadTooLarge,
    #[error("Payload too large")]
    PayloadTooLarge,
    #[error("Invalid upload")]
    InvalidUpload,
    #[error("Bad request")]
    BadRequest,
    #[error("Rate limited")]
    RateLimited,
    #[error("Internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

impl AppError {
    fn code(&self) -> &'static str {
        match self {
            AppError::AuthRequired => "AUTH_REQUIRED",
            AppError::AuthFailed => "AUTH_FAILED",
            AppError::SpaceNotFound => "SPACE_NOT_FOUND",
            AppError::SpaceExists => "SPACE_EXISTS",
            AppError::SessionExpired => "SESSION_EXPIRED",
            AppError::MessageNotFound => "MESSAGE_NOT_FOUND",
            AppError::FileNotFound => "FILE_NOT_FOUND",
            AppError::UploadNotFound => "UPLOAD_NOT_FOUND",
            AppError::UploadChunkOrder => "UPLOAD_CHUNK_ORDER",
            AppError::UploadTooLarge => "UPLOAD_TOO_LARGE",
            AppError::PayloadTooLarge => "PAYLOAD_TOO_LARGE",
            AppError::InvalidUpload => "INVALID_UPLOAD",
            AppError::BadRequest => "BAD_REQUEST",
            AppError::RateLimited => "RATE_LIMITED",
            AppError::Internal(_) => "INTERNAL_ERROR",
        }
    }

    fn status(&self) -> StatusCode {
        match self {
            AppError::AuthRequired | AppError::AuthFailed => StatusCode::UNAUTHORIZED,
            AppError::SessionExpired => StatusCode::UNAUTHORIZED,
            AppError::SpaceNotFound => StatusCode::NOT_FOUND,
            AppError::SpaceExists => StatusCode::CONFLICT,
            AppError::MessageNotFound | AppError::FileNotFound => StatusCode::NOT_FOUND,
            AppError::UploadNotFound => StatusCode::NOT_FOUND,
            AppError::UploadChunkOrder | AppError::InvalidUpload | AppError::BadRequest => {
                StatusCode::BAD_REQUEST
            }
            AppError::UploadTooLarge | AppError::PayloadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            AppError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

#[derive(Serialize)]
struct ErrorBody {
    error: ErrorInfo,
}

#[derive(Serialize)]
struct ErrorInfo {
    code: String,
    message: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status();
        let body = ErrorBody {
            error: ErrorInfo {
                code: self.code().to_string(),
                message: self.to_string(),
            },
        };
        (status, Json(body)).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        tracing::error!("Database error: {e}");
        AppError::Internal(anyhow::anyhow!("Database error"))
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        tracing::error!("IO error: {e}");
        AppError::Internal(anyhow::anyhow!("IO error"))
    }
}

impl From<axum::extract::rejection::JsonRejection> for AppError {
    fn from(_: axum::extract::rejection::JsonRejection) -> Self {
        AppError::BadRequest
    }
}
