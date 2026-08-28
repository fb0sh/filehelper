use axum::body::Body;
use axum::response::Response;
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../../web/dist"]
pub struct WebAssets;

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

        let mut builder = Response::builder()
            .header("Content-Type", mime.as_ref())
            .header("X-Content-Type-Options", "nosniff");

        if is_hashed {
            builder = builder.header("Cache-Control", "public,max-age=31536000,immutable");
        } else {
            builder = builder.header("Cache-Control", "no-cache");
        }

        builder.body(Body::from(file.data.to_vec())).ok()
    } else {
        // Fallback to index.html for SPA
        WebAssets::get("index.html").map(|file| {
            Response::builder()
                .header("Content-Type", "text/html")
                .header("Cache-Control", "no-cache")
                .header("X-Content-Type-Options", "nosniff")
                .body(Body::from(file.data.to_vec()))
                .unwrap()
        })
    }
}
