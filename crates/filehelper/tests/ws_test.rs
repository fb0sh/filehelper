//! End-to-end WebSocket tests against a live in-process server:
//! auth-first protocol, per-space event isolation, batch delete fan-out.

use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message as WsMessage;

type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

mod common;
use common::*;

struct LiveServer {
    addr: SocketAddr,
    app: filehelper::app::App,
    task: tokio::task::JoinHandle<()>,
}

async fn start_live() -> LiveServer {
    let dir = temp_dir("ws-live");
    let app = start_app(dir.clone()).await;
    let router = app.router().fallback(axum::routing::get(|| async {
        axum::http::StatusCode::NOT_FOUND
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    LiveServer { addr, app, task }
}

async fn ws_connect(addr: SocketAddr, token: &str) -> Ws {
    let url = format!("ws://{addr}/api/v1/ws");
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    // First frame must be auth.
    let auth = serde_json::json!({ "type": "auth", "token": token }).to_string();
    ws.send(WsMessage::Text(auth)).await.unwrap();
    // Wait for auth.ok.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        if tokio::time::Instant::now() > deadline {
            panic!("no auth.ok");
        }
        let msg = tokio::time::timeout(Duration::from_secs(1), ws.next())
            .await
            .expect("ws closed before auth.ok")
            .expect("ws error");
        if let Ok(WsMessage::Text(t)) = msg {
            let v: serde_json::Value = serde_json::from_str(&t).unwrap();
            if v["type"] == "auth.ok" {
                return ws;
            }
        }
    }
}

async fn ws_next(ws: &mut Ws) -> Option<serde_json::Value> {
    let msg = tokio::time::timeout(Duration::from_secs(1), ws.next())
        .await
        .ok()??
        .ok()?;
    match msg {
        WsMessage::Text(t) => serde_json::from_str(&t).ok(),
        _ => None,
    }
}

#[tokio::test]
async fn ws_requires_auth_first_and_is_space_isolated() {
    let server = start_live().await;
    let key_a = auth_key_b64();
    let key_b = auth_key_b64();
    let token_a = create_and_login(&server.app, "ws-a", &key_a).await;
    let token_b = create_and_login(&server.app, "ws-b", &key_b).await;

    let mut ws_a: Ws = ws_connect(server.addr, &token_a).await;
    let mut ws_b: Ws = ws_connect(server.addr, &token_b).await;

    // A sends a message → A's socket gets message.created.
    send_text(&server.app, &token_a, "FH1.from-a").await;
    let evt = ws_next(&mut ws_a).await.expect("A should get the event");
    assert_eq!(evt["type"], "message.created");
    assert_eq!(evt["message"]["payload"], "FH1.from-a");

    // B's socket must NOT see it (activity isolation).
    let leak = ws_next(&mut ws_b).await;
    assert!(leak.is_none(), "space B received space A event: {leak:?}");

    // B sends a message → B's socket sees it, A does not.
    send_text(&server.app, &token_b, "FH1.from-b").await;
    let evt_b = ws_next(&mut ws_b).await.expect("B should get its event");
    assert_eq!(evt_b["message"]["payload"], "FH1.from-b");
    let leak = ws_next(&mut ws_a).await;
    assert!(leak.is_none(), "space A received space B event: {leak:?}");

    // Batch delete → messages.deleted with all ids on the owning space.
    let list_b = list_messages(&server.app, &token_b).await;
    let b_id = list_b["messages"][0]["id"].as_str().unwrap();
    let res = json_request(
        &server.app,
        "POST",
        "/api/v1/messages/batch-delete",
        Some(&token_b),
        &format!("{{\"ids\":[\"{b_id}\"]}}"),
    )
    .await;
    assert!(res.status().is_success());
    let evt = ws_next(&mut ws_b).await.expect("delete event expected");
    assert_eq!(evt["type"], "messages.deleted");
    assert_eq!(evt["messageIds"][0], b_id);

    ws_a.close(None).await.ok();
    ws_b.close(None).await.ok();
    server.app.shutdown().await;
    server.task.abort();
}

#[tokio::test]
async fn ws_rejects_bad_token_with_1008() {
    use futures_util::StreamExt;
    let server = start_live().await;
    let url = format!("ws://{}/api/v1/ws", server.addr);
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    ws.send(WsMessage::Text(
        serde_json::json!({ "type": "auth", "token": "bogus" }).to_string(),
    ))
    .await
    .unwrap();
    let msg = tokio::time::timeout(Duration::from_secs(5), ws.next())
        .await
        .expect("server must close")
        .expect("ws error")
        .expect("ws error");
    match msg {
        WsMessage::Close(frame) => {
            let code = frame.as_ref().map(|f| u16::from(f.code));
            assert_eq!(code, Some(1008));
        }
        other => panic!("expected Close(1008), got {other:?}"),
    }
    server.app.shutdown().await;
    server.task.abort();
}
