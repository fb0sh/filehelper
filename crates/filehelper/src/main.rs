#![allow(dead_code)]
mod app;
mod auth;
mod config;
mod db;
mod error;
mod files;
mod realtime;
mod routes;
mod state;
mod web;

use crate::app::App;
use crate::config::Config;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::response::Response;
use clap::Parser;
use std::net::{IpAddr, SocketAddr};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    let config = Config::parse();
    let app = App::start(&config).await.map_err(|e| {
        eprintln!("Error: {e}");
        std::process::exit(1);
    })?;

    let addr: SocketAddr = config
        .addr
        .parse()
        .map_err(|e| format!("Invalid address: {e}"))?;

    print_startup(&app, &addr);

    let router = app.router().fallback(axum::routing::get(serve_spa));
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    app.shutdown().await;
    Ok(())
}

fn print_startup(app: &App, addr: &SocketAddr) {
    println!("FileHelper {}", env!("CARGO_PKG_VERSION"));
    if app.ephemeral {
        println!("(ephemeral mode — data removed on exit)");
    }
    println!();
    println!("Open:");
    if addr.ip().is_unspecified() {
        for ip in lan_ipv4() {
            println!("  http://{ip}:{}", addr.port());
        }
    } else {
        println!("  http://{addr}");
    }
    println!("Data:  {}", app.data_dir.display());
    println!("Security:  End-to-end encrypted content  LAN HTTP mode");
    println!("Use on trusted networks.");
    println!();
    println!("Press Ctrl+C to stop.");
}

fn lan_ipv4() -> Vec<IpAddr> {
    match local_ip_address::list_afinet_netifas() {
        Ok(ifaces) => ifaces
            .into_iter()
            .map(|(_, ip)| ip)
            .filter(|ip| ip.is_ipv4() && !ip.is_loopback())
            .collect(),
        Err(_) => Vec::new(),
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.ok();
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("Shutting down...");
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
