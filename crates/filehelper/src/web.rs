use axum::body::Body;
use axum::response::Response;
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../../web/dist"]
pub struct WebAssets;

/// Content-Security-Policy for the SPA. Blob workers and blob images are
/// allowed (the crypto worker is a plain file; image previews are local
/// Blob URLs). `media-src 'none'` enforces "no video/audio preview".
/// No `upgrade-insecure-requests`: FileHelper explicitly supports plain
/// LAN HTTP.
pub const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'none'; connect-src 'self' ws: wss:; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

pub fn security_headers(builder: axum::http::response::Builder) -> axum::http::response::Builder {
    builder
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        .header("X-Frame-Options", "DENY")
        .header("Content-Security-Policy", CSP)
}

pub fn serve_static(path: &str) -> Option<Response> {
    let path = path.trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    if let Some(file) = WebAssets::get(path) {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        let is_hashed = path.contains('.')
            && path
                .split('/')
                .next_back()
                .map(|f| f.split('.').count() > 2 && f.contains('-'))
                .unwrap_or(false);

        let mut builder =
            security_headers(Response::builder()).header("Content-Type", mime.as_ref());

        if is_hashed {
            builder = builder.header("Cache-Control", "public,max-age=31536000,immutable");
        } else {
            builder = builder.header("Cache-Control", "no-cache");
        }

        builder.body(Body::from(file.data.to_vec())).ok()
    } else {
        // Fallback to index.html for SPA
        WebAssets::get("index.html").map(|file| {
            security_headers(Response::builder())
                .header("Content-Type", "text/html")
                .header("Cache-Control", "no-cache")
                .body(Body::from(file.data.to_vec()))
                .unwrap()
        })
    }
}
