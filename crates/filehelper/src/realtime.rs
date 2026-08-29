use crate::auth::session;
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{
    State, WebSocketUpgrade,
    ws::{CloseFrame, Message, WebSocket},
};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use std::time::Duration;

fn close_policy_violation() -> Message {
    Message::Close(Some(CloseFrame {
        code: 1008,
        reason: "unauthorized".into(),
    }))
}

/// GET /api/v1/ws — WebSocket with in-band auth. The client must send a
/// single `{"type":"auth","token":"<bearer>"}` frame as its first message
/// (within 5s). The server verifies it, subscribes to that space's
/// channel, replies `{"type":"auth.ok"}`, and only then relays events.
///
/// No events of any kind are delivered before auth, and events are
/// strictly space-scoped: Space A sockets never receive Space B events.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    Ok(ws.on_upgrade(move |socket| handle_socket(socket, state)))
}

const AUTH_TIMEOUT: Duration = Duration::from_secs(5);

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();

    // 1. Wait for the auth frame.
    let auth_msg = tokio::time::timeout(AUTH_TIMEOUT, receiver.next()).await;
    let token = match auth_msg {
        Ok(Some(Ok(Message::Text(text)))) => parse_auth_token(&text),
        _ => None,
    };
    let Some(token) = token else {
        let _ = sender.send(close_policy_violation()).await;
        return;
    };

    // 2. Verify the session token.
    let payload = match session::verify_session_token(&state.config.session_secret, &token) {
        Ok(p) => p,
        Err(_) => {
            let _ = sender.send(close_policy_violation()).await;
            return;
        }
    };
    let space_id = payload.space_id;

    // 3. Subscribe to the space channel and acknowledge.
    let rx = state.spaces.subscribe(&space_id);
    if sender
        .send(Message::Text(r#"{"type":"auth.ok"}"#.into()))
        .await
        .is_err()
    {
        return;
    }

    // 4. Relay space events; ping/pong is answered by axum automatically.
    let mut send_task = tokio::spawn(async move {
        let mut rx = rx;
        while let Ok(event) = rx.recv().await {
            if event.space_id != space_id {
                continue; // defensive: never leak across spaces
            }
            let json = serde_json::to_string(&event.event).unwrap();
            if sender.send(Message::Text(json.into())).await.is_err() {
                break;
            }
        }
    });

    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Close(_) = msg {
                break;
            }
        }
    });

    tokio::select! {
        _ = &mut send_task => { recv_task.abort(); }
        _ = &mut recv_task => { send_task.abort(); }
    }
}

fn parse_auth_token(text: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    if v.get("type")?.as_str()? != "auth" {
        return None;
    }
    v.get("token")?.as_str().map(|s| s.to_string())
}
