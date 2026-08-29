mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::{
    cleanup, file_part, multipart_body, multipart_request, session_cookie_header, setup_test_app,
    test_router,
};
use tower::ServiceExt; // for `oneshot`

async fn send_json(
    app: axum::Router,
    method: &str,
    uri: &str,
    cookie: &str,
    json: &str,
) -> axum::response::Response {
    let method = axum::http::Method::from_bytes(method.as_bytes()).unwrap();
    app.oneshot(
        Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", "application/json")
            .header("cookie", cookie)
            .header("x-filehelper-request", "1")
            .body(Body::from(json.to_string()))
            .unwrap(),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn upload_with_no_file_field_returns_400() {
    let (state, tmp) = setup_test_app().await;
    let cookie = session_cookie_header(&state);
    let app = test_router(state);

    // A form field that is not named "file".
    let body = multipart_body(&[String::from(
        "Content-Disposition: form-data; name=\"notfile\"\r\n\r\nhello",
    )]);
    let res = app
        .oneshot(multipart_request("/api/v1/uploads", body, &cookie))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    cleanup(&tmp);
}

#[tokio::test]
async fn upload_with_multiple_file_fields_returns_400() {
    let (state, tmp) = setup_test_app().await;
    let cookie = session_cookie_header(&state);
    let app = test_router(state);

    let body = multipart_body(&[file_part("a.txt", "aaa"), file_part("b.txt", "bbb")]);
    let res = app
        .oneshot(multipart_request("/api/v1/uploads", body, &cookie))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    cleanup(&tmp);
}

#[tokio::test]
async fn upload_then_delete_removes_physical_file() {
    let (state, tmp) = setup_test_app().await;
    let cookie = session_cookie_header(&state);
    let app = test_router(state.clone());

    let body = multipart_body(&[file_part("delete-me.txt", "goodbye")]);
    let res = app
        .clone()
        .oneshot(multipart_request("/api/v1/uploads", body, &cookie))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let message_id = json["id"].as_str().unwrap().to_string();

    let files_dir = tmp.join("files");
    let stored: Vec<_> = std::fs::read_dir(&files_dir).unwrap().collect();
    assert_eq!(stored.len(), 1, "uploaded file should exist on disk");

    let res = send_json(
        app,
        "DELETE",
        &format!("/api/v1/messages/{message_id}"),
        &cookie,
        "",
    )
    .await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // Give the background trash unlink a moment.
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let remaining: Vec<_> = std::fs::read_dir(&files_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .collect();
    assert_eq!(
        remaining.len(),
        0,
        "physical file must be gone after delete"
    );

    cleanup(&tmp);
}

#[tokio::test]
async fn upload_db_failure_rolls_back_stored_file() {
    let (state, tmp) = setup_test_app().await;
    let cookie = session_cookie_header(&state);
    let app = test_router(state.clone());

    // First upload succeeds.
    let body = multipart_body(&[file_part("ok.txt", "fine")]);
    let res = app
        .clone()
        .oneshot(multipart_request("/api/v1/uploads", body, &cookie))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    // Break the DB so the next insert fails after the tmp→files rename.
    sqlx::query("DROP TABLE messages")
        .execute(&state.db)
        .await
        .unwrap();

    let body = multipart_body(&[file_part("broken.txt", "boom")]);
    let res = app
        .oneshot(multipart_request("/api/v1/uploads", body, &cookie))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);

    let files_dir = tmp.join("files");
    let remaining: Vec<_> = std::fs::read_dir(&files_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .collect();
    assert_eq!(
        remaining.len(),
        1,
        "failed upload must not leave an orphan file behind"
    );

    cleanup(&tmp);
}

#[tokio::test]
async fn context_endpoint_returns_ordered_window() {
    let (state, tmp) = setup_test_app().await;
    let cookie = session_cookie_header(&state);
    let app = test_router(state);

    let mut ids = Vec::new();
    for i in 0..5 {
        let res = send_json(
            app.clone(),
            "POST",
            "/api/v1/messages",
            &cookie,
            &format!("{{\"text\":\"ctx-{i}\"}}"),
        )
        .await;
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        ids.push(json["id"].as_str().unwrap().to_string());
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    }

    let res = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/v1/messages/{}/context?limit=10", ids[2]))
                .header("cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

    let texts: Vec<&str> = json["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["text"].as_str().unwrap())
        .collect();
    assert_eq!(
        texts,
        vec!["ctx-0", "ctx-1", "ctx-2", "ctx-3", "ctx-4"],
        "context must be ordered old → new"
    );
    assert!(json["nextCursor"].is_null());

    cleanup(&tmp);
}

#[tokio::test]
async fn search_endpoint_handles_special_characters() {
    let (state, tmp) = setup_test_app().await;
    let cookie = session_cookie_header(&state);
    let app = test_router(state);

    let res = send_json(
        app.clone(),
        "POST",
        "/api/v1/messages",
        &cookie,
        "{\"text\":\"find me\"}",
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);

    for q in ["\"", "(", ")", "*", "-", "OR", "find"] {
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!("/api/v1/search?q={}", urlencoding_lite(q)))
                    .header("cookie", &cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(
            res.status().is_success(),
            "search must not 500 for input: {q}"
        );
    }

    cleanup(&tmp);
}

// Minimal percent-encoding for query strings in tests.
fn urlencoding_lite(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u32),
        })
        .collect()
}
