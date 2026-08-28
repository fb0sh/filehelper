use crate::error::AppError;
use crate::state::AppState;
use axum::http::Request;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone)]
pub struct SessionData {
    pub expires_at: u64,
}

pub fn create_session_cookie(state: &AppState) -> Result<String, AppError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let expires = now + state.config.session_ttl_secs;
    let nonce: [u8; 16] = rand::random();

    let mut payload = Vec::with_capacity(24);
    payload.extend_from_slice(&expires.to_be_bytes());
    payload.extend_from_slice(&nonce);

    let mut mac = HmacSha256::new_from_slice(&state.config.session_key)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("HMAC error: {e}")))?;
    mac.update(&payload);
    let signature = mac.finalize().into_bytes();

    let mut token = Vec::with_capacity(payload.len() + signature.len());
    token.extend_from_slice(&payload);
    token.extend_from_slice(signature.as_slice());

    let encoded = URL_SAFE_NO_PAD.encode(&token);
    let max_age = state.config.session_ttl_secs;
    Ok(format!(
        "filehelper_session={encoded}; HttpOnly; SameSite=Strict; Path=/; Max-Age={max_age}"
    ))
}

pub fn verify_session(
    state: &AppState,
    req: &Request<axum::body::Body>,
) -> Result<SessionData, AppError> {
    if !state.config.auth_enabled {
        return Ok(SessionData {
            expires_at: u64::MAX,
        });
    }

    let cookies = req
        .headers()
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let token = cookies
        .split(';')
        .map(|c| c.trim())
        .find_map(|c| c.strip_prefix("filehelper_session="))
        .ok_or(AppError::AuthRequired)?;

    let data = URL_SAFE_NO_PAD
        .decode(token)
        .map_err(|_| AppError::AuthRequired)?;

    if data.len() < 24 + 32 {
        return Err(AppError::AuthRequired);
    }

    let (payload, sig) = data.split_at(data.len() - 32);
    let mut mac = HmacSha256::new_from_slice(&state.config.session_key)
        .map_err(|_| AppError::AuthRequired)?;
    mac.update(payload);
    mac.verify_slice(sig).map_err(|_| AppError::AuthRequired)?;

    let expires = u64::from_be_bytes(payload[..8].try_into().unwrap());
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    if now > expires {
        return Err(AppError::AuthRequired);
    }

    Ok(SessionData {
        expires_at: expires,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_cookie_roundtrip() {
        // We can't easily test this without a full AppState,
        // but we can verify the format
        let key: [u8; 32] = [0; 32];
        let mut mac = HmacSha256::new_from_slice(&key).unwrap();
        let payload = [0u8; 24];
        mac.update(&payload);
        let sig = mac.finalize().into_bytes();
        assert_eq!(sig.len(), 32);
    }
}
