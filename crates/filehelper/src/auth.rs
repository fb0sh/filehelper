pub mod middleware;
pub mod session;

pub use middleware::{AuthContext, require_auth};

use crate::config::SESSION_TTL_SECS;
use crate::db;
use crate::error::AppError;
use crate::state::AppState;
use axum::Json;
use axum::extract::{ConnectInfo, State};
use axum::http::StatusCode;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::net::SocketAddr;

/// Max accepted login/create request size (JSON).
pub const MAX_AUTH_BODY: usize = 4096;

#[derive(Deserialize)]
pub struct AuthRequest {
    #[serde(rename = "spaceId")]
    pub space_id: String,
    #[serde(rename = "authKey")]
    pub auth_key: String,
}

#[derive(serde::Serialize)]
pub struct AuthResponse {
    #[serde(rename = "sessionToken")]
    pub session_token: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: u64,
}

/// SHA-256 of the client-derived auth key — the only auth material the
/// server ever stores. The CODE, root key, message key and file master
/// key never leave the browser.
fn hash_auth_key(auth_key_b64: &str) -> Result<[u8; 32], AppError> {
    let key = URL_SAFE_NO_PAD
        .decode(auth_key_b64)
        .map_err(|_| AppError::AuthFailed)?;
    if key.len() != 32 {
        return Err(AppError::AuthFailed);
    }
    Ok(Sha256::digest(&key).into())
}

fn client_ip(parts: &axum::http::request::Parts) -> std::net::IpAddr {
    parts
        .extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip())
        .or_else(|| {
            parts
                .headers
                .get("x-forwarded-for")
                .and_then(|v| v.to_str().ok())
                .and_then(|fwd| fwd.split(',').next().map(str::trim))
                .and_then(|s| s.parse().ok())
        })
        .unwrap_or_else(|| std::net::IpAddr::from([127, 0, 0, 1]))
}

/// Extract a raw header list (IP) without consuming the body, so it can
/// coexist with the Json extractor.
#[derive(Clone, Copy)]
pub struct ConnInfo {
    pub ip: std::net::IpAddr,
}

impl<S: Send + Sync> axum::extract::FromRequestParts<S> for ConnInfo {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        Ok(ConnInfo {
            ip: client_ip(parts),
        })
    }
}

/// POST /auth/login — verify a derived auth key against an existing
/// space and mint a Bearer session token.
pub async fn login(
    State(state): State<AppState>,
    ConnInfo { ip }: ConnInfo,
    Json(body): Json<AuthRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    state.login_limiter.check(&ip)?;
    let verifier = hash_auth_key(&body.auth_key)?;

    match db::spaces::verify_space(&state.db, &body.space_id, &verifier).await {
        Ok(()) => {
            state.login_limiter.clear(&ip);
            let token = session::issue_session_token(
                &state.config.session_secret,
                &body.space_id,
                SESSION_TTL_SECS,
            )?;
            let payload =
                session::verify_session_token(&state.config.session_secret, &token).unwrap();
            Ok(Json(AuthResponse {
                session_token: token,
                expires_at: payload.exp,
            }))
        }
        Err(e @ (AppError::SpaceNotFound | AppError::AuthFailed)) => {
            state.login_limiter.record_failure(&ip);
            Err(e)
        }
        Err(e) => Err(e),
    }
}

/// POST /auth/create — register a new space. Rate limited (10/min/IP) to
/// prevent mass empty-space creation.
pub async fn create_space(
    State(state): State<AppState>,
    ConnInfo { ip }: ConnInfo,
    Json(body): Json<AuthRequest>,
) -> Result<StatusCode, AppError> {
    state.create_limiter.check(&ip)?;
    // Every create attempt counts toward the per-IP budget.
    state.create_limiter.record_failure(&ip);
    let verifier = hash_auth_key(&body.auth_key)?;
    db::spaces::create_space(&state.db, &body.space_id, &verifier).await?;
    Ok(StatusCode::NO_CONTENT)
}
