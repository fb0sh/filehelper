mod auth;
mod files;
mod info;
mod messages;
mod uploads;

use crate::state::AppState;
use axum::body::Body;
use axum::http::Request;
use axum::middleware::Next;
use axum::response::Response;
use axum::{
    Router, middleware,
    routing::{get, post, put},
};

/// Largest single request body the server accepts: one encrypted chunk
/// (8 MiB + tag) plus slack. Message payloads (256 KiB) and JSON bodies
/// are validated further inside their handlers.
const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;

/// Unified security headers for every API response.
pub async fn security_headers(
    req: Request<Body>,
    next: Next,
) -> Result<Response, axum::http::StatusCode> {
    let mut res = next.run(req).await;
    res.headers_mut().insert(
        axum::http::header::HeaderName::from_static("x-content-type-options"),
        "nosniff".parse().unwrap(),
    );
    res.headers_mut().insert(
        axum::http::header::HeaderName::from_static("referrer-policy"),
        "no-referrer".parse().unwrap(),
    );
    res.headers_mut().insert(
        axum::http::header::HeaderName::from_static("x-frame-options"),
        "DENY".parse().unwrap(),
    );
    res.headers_mut().insert(
        axum::http::header::HeaderName::from_static("content-security-policy"),
        crate::web::CSP.parse().unwrap(),
    );
    Ok(res)
}

pub fn build_router(state: AppState) -> Router {
    let public = Router::new()
        .route("/info", get(info::info))
        .route("/auth/login", post(auth::login))
        .route("/auth/create", post(auth::create))
        .route("/ws", get(crate::realtime::ws_handler))
        .with_state(state.clone());

    let protected = Router::new()
        .route("/messages", get(messages::list).post(messages::create))
        .route("/messages/batch-delete", post(messages::batch_delete))
        .route("/messages/{id}/context", get(messages::context))
        .route(
            "/messages/{id}",
            get(messages::get).delete(messages::delete),
        )
        .route("/clear", post(messages::clear_all))
        .route("/uploads", post(uploads::init))
        .route("/uploads/{upload_id}/chunks/{index}", put(uploads::chunk))
        .route("/uploads/{upload_id}/complete", post(uploads::complete))
        .route(
            "/uploads/{upload_id}",
            axum::routing::delete(uploads::cancel),
        )
        .route("/files/{id}/download", get(files::download))
        .route("/storage", get(info::storage))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::auth::require_auth,
        ))
        .with_state(state.clone());

    let api = public.merge(protected);

    Router::new()
        .nest("/api/v1", api)
        .layer(axum::extract::DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(middleware::from_fn(security_headers))
        .with_state(state)
}
