use crate::auth;
use crate::state::AppState;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;

pub async fn login(
    State(state): State<AppState>,
    conn: auth::ConnInfo,
    Json(body): Json<auth::AuthRequest>,
) -> Result<Json<auth::AuthResponse>, crate::error::AppError> {
    auth::login(State(state), conn, Json(body)).await
}

pub async fn create(
    State(state): State<AppState>,
    conn: auth::ConnInfo,
    Json(body): Json<auth::AuthRequest>,
) -> Result<StatusCode, crate::error::AppError> {
    auth::create_space(State(state), conn, Json(body)).await
}
