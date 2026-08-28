use crate::error::AppError;
use crate::state::AppState;
use axum::body::Body;
use axum::extract::State;
use axum::http::Request;
use axum::middleware::Next;
use axum::response::Response;

pub async fn require_auth(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    if !state.config.auth_enabled {
        return Ok(next.run(req).await);
    }

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

    super::session::verify_session(&state, &req)?;
    Ok(next.run(req).await)
}
