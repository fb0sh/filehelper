use crate::error::AppError;
use crate::state::AppState;
use axum::body::Body;
use axum::extract::State;
use axum::http::Request;
use axum::middleware::Next;
use axum::response::Response;
use std::sync::Arc;

/// Authenticated space identity, produced by the auth middleware and
/// consumed by handlers via the `AuthContext` extractor.
#[derive(Debug, Clone)]
pub struct AuthContext {
    pub space_id: String,
    pub expires_at: u64,
}

impl<S: Send + Sync> axum::extract::FromRequestParts<S> for AuthContext {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<Arc<AuthContext>>()
            .map(|a| (**a).clone())
            .ok_or(AppError::AuthRequired)
    }
}

/// Require a valid Bearer session token on every request. Inserts the
/// decoded AuthContext into request extensions for handlers.
pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    // Defense in depth: mutations still require the explicit header.
    let is_mutation = matches!(req.method().as_str(), "POST" | "PUT" | "PATCH" | "DELETE");
    if is_mutation {
        let has_header = req
            .headers()
            .get("x-filehelper-request")
            .map(|v| v.as_bytes() == b"1")
            .unwrap_or(false);
        if !has_header {
            return Err(AppError::AuthRequired);
        }
    }

    let token = super::session::bearer_token(req.headers()).ok_or(AppError::AuthRequired)?;
    let payload = super::session::verify_session_token(&state.config.session_secret, token)?;

    let ctx = Arc::new(AuthContext {
        space_id: payload.space_id,
        expires_at: payload.exp,
    });
    req.extensions_mut().insert(ctx);

    Ok(next.run(req).await)
}
