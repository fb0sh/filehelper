use crate::error::AppError;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;

pub const COOKIE_NAME: &str = "filehelper_session";

#[derive(Debug, Clone)]
pub struct SessionData {
    pub issued_at: u64,
    pub expires_at: u64,
}

// Stateless signed cookie:
//   payload = expires_at(8B) || issued_at(8B) || nonce(16B)
//   token   = base64url(payload || HMAC-SHA256(signing_key, payload))
// No session table, no per-browser state. Old cookies survive restarts
// because the signing key is persisted in the secret file (and rotated
// by --reset-code, which invalidates all existing sessions).
pub fn issue_session_cookie(
    signing_key: &[u8; 32],
    ttl_secs: u64,
    secure: bool,
) -> Result<String, AppError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let expires = now + ttl_secs;
    let nonce: [u8; 16] = rand::random();

    let mut payload = Vec::with_capacity(32);
    payload.extend_from_slice(&expires.to_be_bytes());
    payload.extend_from_slice(&now.to_be_bytes());
    payload.extend_from_slice(&nonce);

    let mut mac = HmacSha256::new_from_slice(signing_key)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("HMAC error: {e}")))?;
    mac.update(&payload);
    let signature = mac.finalize().into_bytes();

    let mut token = payload;
    token.extend_from_slice(&signature);

    let encoded = URL_SAFE_NO_PAD.encode(&token);
    let secure_attr = if secure { " Secure" } else { "" };
    Ok(format!(
        "{COOKIE_NAME}={encoded}; HttpOnly; SameSite=Strict; Path=/; Max-Age={ttl_secs}{secure_attr}"
    ))
}

pub fn verify_session_cookie(
    signing_key: &[u8; 32],
    cookie_header: &str,
) -> Result<SessionData, AppError> {
    let token = cookie_header
        .split(';')
        .map(|c| c.trim())
        .find_map(|c| c.strip_prefix(&format!("{COOKIE_NAME}=")))
        .ok_or(AppError::AuthRequired)?;

    let data = URL_SAFE_NO_PAD
        .decode(token)
        .map_err(|_| AppError::AuthRequired)?;

    if data.len() < 32 + 32 {
        return Err(AppError::AuthRequired);
    }

    let (payload, sig) = data.split_at(data.len() - 32);
    let mut mac = HmacSha256::new_from_slice(signing_key).map_err(|_| AppError::AuthRequired)?;
    mac.update(payload);
    // Constant-time comparison.
    mac.verify_slice(sig).map_err(|_| AppError::AuthRequired)?;

    let expires = u64::from_be_bytes(payload[..8].try_into().unwrap());
    let issued = u64::from_be_bytes(payload[8..16].try_into().unwrap());
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    if now > expires {
        return Err(AppError::AuthRequired);
    }

    Ok(SessionData {
        issued_at: issued,
        expires_at: expires,
    })
}

pub fn is_https(headers: &axum::http::HeaderMap) -> bool {
    headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("https"))
        .unwrap_or(false)
}
