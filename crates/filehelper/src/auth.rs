pub mod middleware;
pub mod password;
mod session;

pub use middleware::require_auth;

use crate::state::AppState;
use axum::Json;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct LoginRequest {
    pub password: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub ok: bool,
}

pub async fn login(
    state: axum::extract::State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<axum::response::Response, crate::error::AppError> {
    if !state.config.auth_enabled {
        return Ok(axum::response::Response::builder()
            .status(axum::http::StatusCode::OK)
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(
                serde_json::to_string(&LoginResponse { ok: true }).unwrap(),
            ))
            .unwrap());
    }
    let db = &state.db;
    let stored_hash = sqlx::query_scalar::<_, String>(
        "SELECT value FROM meta WHERE key = 'password_hash'",
    )
    .fetch_optional(db)
    .await?;

    let Some(hash) = stored_hash else {
        return Err(crate::error::AppError::Internal(anyhow::anyhow!(
            "No password hash found"
        )));
    };

    if password::verify_password(&req.password, &hash)? {
        let session = session::create_session_cookie(&state)?;
        let mut response = axum::response::Response::new(axum::body::Body::from(
            serde_json::to_string(&LoginResponse { ok: true }).unwrap(),
        ));
        *response.status_mut() = axum::http::StatusCode::OK;
        response.headers_mut().insert(
            axum::http::header::CONTENT_TYPE,
            "application/json".parse().unwrap(),
        );
        response
            .headers_mut()
            .insert("set-cookie", session.parse().unwrap());
        Ok(response)
    } else {
        Err(crate::error::AppError::InvalidPassword)
    }
}

pub async fn logout() -> impl axum::response::IntoResponse {
    let cookie = "filehelper_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
    let mut response = axum::http::Response::new(axum::body::Body::empty());
    response
        .headers_mut()
        .insert("set-cookie", cookie.parse().unwrap());
    response
}

pub async fn session_check(
    state: axum::extract::State<AppState>,
    req: axum::http::Request<axum::body::Body>,
) -> Result<Json<serde_json::Value>, crate::error::AppError> {
    let session = session::verify_session(&state, &req)?;
    Ok(Json(serde_json::json!({
        "authenticated": true,
        "expiresAt": session.expires_at,
    })))
}