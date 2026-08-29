pub mod middleware;
pub mod password;
pub mod session;

pub use middleware::require_auth;

use crate::config::{ACCESS_CODE_MAX, ACCESS_CODE_MIN, SESSION_TTL_SECS};
use crate::error::AppError;
use crate::state::AppState;
use axum::Json;
use axum::body::Body;
use axum::extract::{ConnectInfo, State};
use axum::http::Request;
use axum::response::Response;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::Path;
use subtle::ConstantTimeEq;

// ---------------------------------------------------------------------------
// Access code + signing secret lifecycle
// ---------------------------------------------------------------------------

const SECRET_FILE: &str = "secret";

/// Everything the runtime needs to verify access codes and sign sessions.
pub struct AuthBundle {
    /// Access code for terminal display. None under a --password override.
    pub access_code: Option<String>,
    /// HMAC signing key for session cookies.
    pub signing_key: [u8; 32],
    /// Literal code used for this process only (--password override).
    pub runtime_code: Option<String>,
}

/// Prepare auth for this run.
///
/// Default (no `runtime_code`): the access code is regenerated on every
/// start — a fresh 6-digit code and a fresh session signing key — while
/// all messages and files are kept. The secret file and the Argon2id
/// hash in SQLite are updated to the new code, and old browser sessions
/// become invalid because the signing key changed.
///
/// A `runtime_code` (--password) skips all persistence and uses a fresh
/// in-memory signing key, so nothing survives the process.
pub async fn init_auth(
    data_dir: &Path,
    pool: &sqlx::SqlitePool,
    runtime_code: Option<&str>,
) -> Result<AuthBundle, AppError> {
    if let Some(code) = runtime_code {
        return Ok(AuthBundle {
            access_code: None,
            signing_key: rand::random(),
            runtime_code: Some(code.to_string()),
        });
    }
    rotate_or_create(data_dir, pool).await
}

// Generate a fresh code + signing key, persist both, and update the hash.
async fn rotate_or_create(
    data_dir: &Path,
    pool: &sqlx::SqlitePool,
) -> Result<AuthBundle, AppError> {
    let access_code = generate_access_code();
    let signing_key: [u8; 32] = rand::random();
    write_secret_file(&data_dir.join(SECRET_FILE), &access_code, &signing_key)?;

    let hash = password::hash_password(&access_code)?;
    sqlx::query(
        "INSERT INTO meta (key, value) VALUES ('access_code_hash', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(&hash)
    .execute(pool)
    .await?;

    Ok(AuthBundle {
        access_code: Some(access_code),
        signing_key,
        runtime_code: None,
    })
}

/// Explicitly rotate the access code (same as a fresh start): new code,
/// new signing key (old sessions invalid), messages and files kept.
pub async fn reset_access_code(
    data_dir: &Path,
    pool: &sqlx::SqlitePool,
) -> Result<AuthBundle, AppError> {
    rotate_or_create(data_dir, pool).await
}

/// 6-digit access code from the OS CSPRNG (100000..=999999).
pub fn generate_access_code() -> String {
    let n: u32 = rand::random();
    let code = ACCESS_CODE_MIN + (n % (ACCESS_CODE_MAX - ACCESS_CODE_MIN + 1));
    format!("{code:06}")
}

fn write_secret_file(path: &Path, code: &str, key: &[u8; 32]) -> Result<(), AppError> {
    let hex: String = key.iter().map(|b| format!("{b:02x}")).collect();
    std::fs::write(path, format!("{code}\n{hex}\n"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Verification + login
// ---------------------------------------------------------------------------

pub async fn verify_access_code(state: &AppState, input: &str) -> Result<bool, AppError> {
    if let Some(runtime) = &state.config.runtime_code {
        // Constant-time comparison for the runtime override.
        return Ok(bool::from(input.as_bytes().ct_eq(runtime.as_bytes())));
    }
    let hash =
        sqlx::query_scalar::<_, String>("SELECT value FROM meta WHERE key = 'access_code_hash'")
            .fetch_optional(&state.db)
            .await?;
    let Some(hash) = hash else {
        return Err(AppError::Internal(anyhow::anyhow!(
            "No access code hash found"
        )));
    };
    // Argon2 verify is the constant-time comparison here.
    Ok(password::verify_password(input, &hash)?)
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub code: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub ok: bool,
}

/// Client connection info needed by the login handler. Extracted without
/// consuming the body so it can coexist with `Json`. Falls back to a
/// loopback address when no ConnectInfo layer is present (tests, proxies).
#[derive(Clone, Copy)]
pub struct ConnInfo {
    pub ip: std::net::IpAddr,
    pub secure: bool,
}

impl<S: Send + Sync> axum::extract::FromRequestParts<S> for ConnInfo {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        let ip = parts
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
            .unwrap_or_else(|| std::net::IpAddr::from([127, 0, 0, 1]));
        let secure = session::is_https(&parts.headers);
        Ok(ConnInfo { ip, secure })
    }
}

pub async fn login(
    State(state): State<AppState>,
    ConnInfo { ip, secure }: ConnInfo,
    Json(body): Json<LoginRequest>,
) -> Result<Response, AppError> {
    state.rate_limiter.check(&ip)?;

    if verify_access_code(&state, body.code.trim()).await? {
        state.rate_limiter.clear(&ip);
        let cookie =
            session::issue_session_cookie(&state.config.signing_key, SESSION_TTL_SECS, secure)?;
        let mut response = Response::new(Body::from(
            serde_json::to_string(&LoginResponse { ok: true }).unwrap(),
        ));
        *response.status_mut() = axum::http::StatusCode::OK;
        response.headers_mut().insert(
            axum::http::header::CONTENT_TYPE,
            "application/json".parse().unwrap(),
        );
        response
            .headers_mut()
            .insert("set-cookie", cookie.parse().unwrap());
        Ok(response)
    } else {
        state.rate_limiter.record_failure(&ip);
        Err(AppError::InvalidPassword)
    }
}

pub async fn logout() -> impl axum::response::IntoResponse {
    let cookie = format!(
        "{}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        session::COOKIE_NAME
    );
    let mut response = axum::http::Response::new(Body::empty());
    response
        .headers_mut()
        .insert("set-cookie", cookie.parse().unwrap());
    response
}

pub async fn session_check(
    State(state): State<AppState>,
    req: Request<Body>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cookie_header = req
        .headers()
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let data = session::verify_session_cookie(&state.config.signing_key, cookie_header)?;
    Ok(Json(serde_json::json!({
        "authenticated": true,
        "expiresAt": data.expires_at,
    })))
}
