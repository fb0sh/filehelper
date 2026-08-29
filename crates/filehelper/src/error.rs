#![allow(dead_code)]
use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Authentication required")]
    AuthRequired,
    #[error("Invalid access code")]
    InvalidPassword,
    #[error("Message not found")]
    MessageNotFound,
    #[error("File not found")]
    FileNotFound,
    #[error("Upload too large")]
    UploadTooLarge,
    #[error("Invalid upload")]
    InvalidUpload,
    #[error("Rate limited")]
    RateLimited,
    #[error("Internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

impl AppError {
    fn code(&self) -> &'static str {
        match self {
            AppError::AuthRequired => "AUTH_REQUIRED",
            AppError::InvalidPassword => "INVALID_PASSWORD",
            AppError::MessageNotFound => "MESSAGE_NOT_FOUND",
            AppError::FileNotFound => "FILE_NOT_FOUND",
            AppError::UploadTooLarge => "UPLOAD_TOO_LARGE",
            AppError::InvalidUpload => "INVALID_UPLOAD",
            AppError::RateLimited => "RATE_LIMITED",
            AppError::Internal(_) => "INTERNAL_ERROR",
        }
    }

    fn status(&self) -> StatusCode {
        match self {
            AppError::AuthRequired | AppError::InvalidPassword => StatusCode::UNAUTHORIZED,
            AppError::MessageNotFound | AppError::FileNotFound => StatusCode::NOT_FOUND,
            AppError::UploadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            AppError::InvalidUpload => StatusCode::BAD_REQUEST,
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

impl From<argon2::password_hash::Error> for AppError {
    fn from(e: argon2::password_hash::Error) -> Self {
        tracing::error!("Password hash error: {e}");
        AppError::Internal(anyhow::anyhow!("Password hash error"))
    }
}

impl From<axum::extract::multipart::MultipartError> for AppError {
    fn from(e: axum::extract::multipart::MultipartError) -> Self {
        tracing::error!("Multipart error: {e}");
        AppError::InvalidUpload
    }
}
