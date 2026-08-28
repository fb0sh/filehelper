mod auth;
mod files;
mod info;
mod messages;
mod search;
mod uploads;

use crate::state::AppState;
use axum::{
    Router, middleware,
    routing::{delete, get, post},
};

pub fn build_router(state: AppState) -> Router {
    let public = Router::new()
        .route("/info", get(info::info))
        .route("/auth/login", post(auth::login))
        .with_state(state.clone());

    let protected = Router::new()
        .route("/auth/logout", post(auth::logout))
        .route("/auth/session", get(auth::session))
        .route("/messages", get(messages::list).post(messages::create))
        .route("/messages/{id}", delete(messages::delete))
        .route("/uploads", post(uploads::upload))
        .route("/files/{id}/content", get(files::content))
        .route("/files/{id}/download", get(files::download))
        .route("/search", get(search::search))
        .route("/storage", get(info::storage))
        .route("/ws", get(crate::realtime::ws_handler))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::auth::require_auth,
        ))
        .with_state(state.clone());

    let api = public.merge(protected);

    Router::new().nest("/api/v1", api).with_state(state)
}
