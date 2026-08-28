use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{
    ws::{Message, WebSocket},
    State, WebSocketUpgrade,
};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    // Verify auth through cookie
    let rx = state.broadcast.subscribe();

    Ok(ws.on_upgrade(move |socket| handle_socket(socket, rx)))
}

async fn handle_socket(socket: WebSocket, rx: tokio::sync::broadcast::Receiver<crate::state::BroadcastEvent>) {
    let (mut sender, mut receiver) = socket.split();

    // Send events to client
    let mut send_task = tokio::spawn(async move {
        let mut rx = rx;
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let json = serde_json::to_string(&event).unwrap();
                    if sender.send(Message::Text(json.into())).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Handle incoming messages (pings, etc.)
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Ping(data) => {
                    // Pong is handled automatically by axum
                    let _ = data;
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = &mut send_task => { recv_task.abort(); }
        _ = &mut recv_task => { send_task.abort(); }
    }
}