use crate::error::AppError;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionPayload {
    #[serde(rename = "spaceId")]
    pub space_id: String,
    pub iat: u64,
    pub exp: u64,
    pub nonce: String,
}

/// Issue a stateless Bearer session token:
///   base64url(payload_json) "." base64url(HMAC-SHA256(secret, payload_json))
/// No server-side session table; expiry and signature are checked on
/// every request. The secret is persisted (session-secret, 0600) so
/// tokens survive a server restart.
pub fn issue_session_token(
    secret: &[u8; 32],
    space_id: &str,
    ttl_secs: u64,
) -> Result<String, AppError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let nonce: [u8; 16] = rand::random();
    let payload = SessionPayload {
        space_id: space_id.to_string(),
        iat: now,
        exp: now + ttl_secs,
        nonce: URL_SAFE_NO_PAD.encode(nonce),
    };
    let payload_json = serde_json::to_vec(&payload)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("serialize session: {e}")))?;

    let mut mac = HmacSha256::new_from_slice(secret)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("HMAC error: {e}")))?;
    mac.update(&payload_json);
    let signature = mac.finalize().into_bytes();

    Ok(format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(&payload_json),
        URL_SAFE_NO_PAD.encode(signature)
    ))
}

/// Verify a Bearer token. Returns the parsed payload on success.
pub fn verify_session_token(secret: &[u8; 32], token: &str) -> Result<SessionPayload, AppError> {
    let Some((payload_b64, sig_b64)) = token.split_once('.') else {
        return Err(AppError::AuthRequired);
    };

    let payload = URL_SAFE_NO_PAD
        .decode(payload_b64)
        .map_err(|_| AppError::AuthRequired)?;
    let sig = URL_SAFE_NO_PAD
        .decode(sig_b64)
        .map_err(|_| AppError::AuthRequired)?;

    let mut mac = HmacSha256::new_from_slice(secret).map_err(|_| AppError::AuthRequired)?;
    mac.update(&payload);
    // Constant-time comparison.
    mac.verify_slice(&sig).map_err(|_| AppError::AuthRequired)?;

    let parsed: SessionPayload =
        serde_json::from_slice(&payload).map_err(|_| AppError::AuthRequired)?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    if now > parsed.exp {
        return Err(AppError::SessionExpired);
    }
    Ok(parsed)
}

/// Extract the Bearer token from an Authorization header.
pub fn bearer_token(headers: &axum::http::HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|t| !t.is_empty())
}
