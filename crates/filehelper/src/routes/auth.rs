use crate::auth;
use crate::state::AppState;
use axum::extract::State;
use axum::response::Response;
use axum::Json;

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<auth::LoginRequest>,
) -> Result<Response, crate::error::AppError> {
    auth::login(State(state), Json(req)).await
}

pub async fn logout() -> impl axum::response::IntoResponse {
    auth::logout().await
}

pub async fn session(
    State(state): State<AppState>,
    req: axum::http::Request<axum::body::Body>,
) -> Result<Json<serde_json::Value>, crate::error::AppError> {
    auth::session_check(State(state), req).await
}