mod auth;
mod config;
mod db;
mod error;
mod files;
mod realtime;
mod routes;
mod state;
mod web;

use crate::config::Config;
use crate::state::{AppConfig, AppState};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::response::Response;
use base64::Engine;
use clap::Parser;
use sqlx::sqlite::SqlitePoolOptions;
use std::net::SocketAddr;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    let config = Config::parse();
    let password = config.resolve_password().map_err(|e| {
        eprintln!("Error: {e}");
        std::process::exit(1);
    })?;

    let auth_enabled = password.is_some();
    let password = password.unwrap_or_default();

    // Ensure data directories
    std::fs::create_dir_all(&config.data_dir)?;
    files::storage::ensure_dirs(&config.data_dir)?;

    // Database
    let db_path = config.data_dir.join("filehelper.db");
    let db_url = format!("sqlite://{}?mode=rwc", db_path.display());
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await?;

    db::init_db(&pool).await?;

    // Generate or load auth salt
    let salt = load_or_create_salt(&pool).await?;

    // Derive keys from password
    let (_auth_key, session_key) = auth::password::derive_keys(&password, &salt);

    // Hash and store password if not already stored
    if auth_enabled {
        let existing = sqlx::query_scalar::<_, String>(
            "SELECT value FROM meta WHERE key = 'password_hash'",
        )
        .fetch_optional(&pool)
        .await?;
        if existing.is_none() {
            let hash = auth::password::hash_password(&password)
                .map_err(|e| format!("Password hashing error: {e}"))?;
            sqlx::query("INSERT INTO meta (key, value) VALUES ('password_hash', ?1)")
                .bind(&hash)
                .execute(&pool)
                .await?;
        }
    }

    let session_ttl_secs = config.parse_session_ttl_secs().map_err(|e| {
        eprintln!("Error: {e}");
        std::process::exit(1);
    })?;

    let app_config = AppConfig {
        name: config.name.clone(),
        max_upload_size: config.max_upload_size,
        data_dir: config.data_dir.clone(),
        files_dir: config.data_dir.join("files"),
        tmp_dir: config.data_dir.join("tmp"),
        trash_dir: config.data_dir.join("trash"),
        auth_enabled,
        session_ttl_secs,
        auth_salt: salt,
        session_key,
    };

    let state = AppState::new(pool.clone(), app_config);

    // Startup cleanup
    files::gc::cleanup_tmp(&state).await;

    let router = routes::build_router(state.clone());

    // Fallback to SPA
    let app = router.fallback(axum::routing::get(serve_spa));

    // Print startup info
    println!("FileHelper 0.1.0");
    println!();
    println!("Listening:");
    let addr: SocketAddr = config
        .addr
        .parse()
        .map_err(|e| format!("Invalid address: {e}"))?;
    println!("  http://{}", addr);

    if !addr.ip().is_loopback() {
        println!();
        println!(
            "⚠ Security: HTTP on non-loopback — consider using a reverse proxy with TLS."
        );
    }

    println!();
    println!("Data:");
    println!("  {}", config.data_dir.display());
    println!();
    println!("Authentication:");
    if auth_enabled {
        println!("  enabled");
    } else {
        println!("  disabled (--no-auth)");
    }

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(async {
            tokio::signal::ctrl_c().await.ok();
            tracing::info!("Shutting down...");
        })
        .await?;

    Ok(())
}

async fn load_or_create_salt(pool: &sqlx::SqlitePool) -> Result<[u8; 32], Box<dyn std::error::Error>> {
    let existing = sqlx::query_scalar::<_, String>("SELECT value FROM meta WHERE key = 'auth_salt'")
        .fetch_optional(pool)
        .await?;

    if let Some(salt_str) = existing {
        let bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &salt_str,
        )?;
        let mut salt = [0u8; 32];
        salt.copy_from_slice(&bytes[..32]);
        Ok(salt)
    } else {
        let salt: [u8; 32] = rand::random();
        let encoded = base64::engine::general_purpose::STANDARD.encode(&salt);
        sqlx::query("INSERT INTO meta (key, value) VALUES ('auth_salt', ?1)")
            .bind(&encoded)
            .execute(pool)
            .await?;
        Ok(salt)
    }
}

async fn serve_spa(req: Request<Body>) -> Response {
    let path = req.uri().path().to_string();
    if let Some(response) = web::serve_static(&path) {
        response
    } else {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not Found"))
            .unwrap()
    }
}