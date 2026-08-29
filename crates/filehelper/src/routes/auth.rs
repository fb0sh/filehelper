use crate::auth;
use crate::state::AppState;
use axum::Json;
use axum::extract::State;
use axum::response::Response;

pub async fn login(
    State(state): State<AppState>,
    conn: auth::ConnInfo,
    Json(body): Json<auth::LoginRequest>,
) -> Result<Response, crate::error::AppError> {
    auth::login(State(state), conn, Json(body)).await
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
