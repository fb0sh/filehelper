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

    // HTTPS is the default (secure context ⇒ native Save-as dialog);
    // --no-tls opts back into plain LAN HTTP.
    let tls = !config.no_tls;
    print_startup(&app, &addr, tls);

    let router = app.router().fallback(axum::routing::get(serve_spa));
    let service = router.into_make_service_with_connect_info::<SocketAddr>();

    if tls {
        // HTTPS with an auto-generated self-signed certificate. The
        // browser treats https origins as secure contexts, which exposes
        // showSaveFilePicker — the native OS "Save as" dialog. Plain LAN
        // HTTP cannot offer it (browser platform rule).
        let certified = generate_cert()?;
        let tls = axum_server::tls_rustls::RustlsConfig::from_pem(
            certified.cert_pem.into_bytes(),
            certified.key_pem.into_bytes(),
        )
        .await?;
        let handle = axum_server::Handle::new();
        let h = handle.clone();
        tokio::spawn(async move {
            shutdown_signal().await;
            h.graceful_shutdown(None);
        });
        axum_server::bind_rustls(addr, tls)
            .handle(handle)
            .serve(service)
            .await?;
    } else {
        let listener = tokio::net::TcpListener::bind(&addr).await?;
        axum::serve(listener, service)
            .with_graceful_shutdown(shutdown_signal())
            .await?;
    }

    app.shutdown().await;
    Ok(())
}

struct CertifiedPem {
    cert_pem: String,
    key_pem: String,
}

/// Self-signed ECDSA certificate covering localhost + every LAN IPv4, so
/// both local and remote access get a (bypassable) browser warning and,
/// once accepted, a secure context. Regenerated on every launch.
fn generate_cert() -> Result<CertifiedPem, Box<dyn std::error::Error>> {
    use rcgen::string::Ia5String;
    use rcgen::{CertificateParams, KeyPair, SanType};
    use std::net::{IpAddr, Ipv4Addr};

    let mut params = CertificateParams::default();
    params.subject_alt_names = vec![
        SanType::DnsName(Ia5String::try_from("localhost")?),
        SanType::IpAddress(IpAddr::V4(Ipv4Addr::LOCALHOST)),
    ];
    for ip in lan_ipv4() {
        params.subject_alt_names.push(SanType::IpAddress(ip));
    }
    let key_pair = KeyPair::generate()?;
    let cert = params.self_signed(&key_pair)?;
    Ok(CertifiedPem {
        cert_pem: cert.pem(),
        key_pem: key_pair.serialize_pem(),
    })
}

fn print_startup(app: &App, addr: &SocketAddr, tls: bool) {
    let scheme = if tls { "https" } else { "http" };
    println!("FileHelper {}", env!("CARGO_PKG_VERSION"));
    if app.ephemeral {
        println!("(ephemeral mode — data removed on exit)");
    }
    println!();
    println!("Open:");
    if addr.ip().is_unspecified() {
        for ip in lan_ipv4() {
            println!("  {scheme}://{ip}:{}", addr.port());
        }
    } else {
        println!("  {scheme}://{addr}");
    }
    println!("Data:  {}", app.data_dir.display());
    if tls {
        println!(
            "TLS:   HTTPS default — self-signed certificate (accept the browser warning once)"
        );
        println!(
            "       enables the native OS Save-as dialog over LAN; use --no-tls for plain HTTP"
        );
    } else {
        println!(
            "Security:  End-to-end encrypted content  LAN HTTP mode (HTTPS disabled via --no-tls)"
        );
        println!("Use on trusted networks.");
    }
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
