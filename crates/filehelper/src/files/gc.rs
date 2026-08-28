use crate::state::AppState;
use std::time::{SystemTime, UNIX_EPOCH};

pub async fn cleanup_tmp(state: &AppState) {
    let tmp_dir = &state.config.tmp_dir;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let cutoff = now - 86400; // 24 hours

    if let Ok(mut entries) = tokio::fs::read_dir(tmp_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(metadata) = entry.metadata().await
                && let Ok(modified) = metadata.modified()
                && let Ok(dur) = modified.duration_since(UNIX_EPOCH)
                && dur.as_secs() < cutoff
            {
                let path = entry.path();
                if path.extension().map(|e| e == "part").unwrap_or(false) {
                    let _ = tokio::fs::remove_file(&path).await;
                    tracing::info!("Cleaned up stale tmp file: {}", path.display());
                }
            }
        }
    }

    // Clean up trash files that no longer have DB references
    let trash_dir = &state.config.trash_dir;
    if let Ok(mut entries) = tokio::fs::read_dir(trash_dir).await {
        let orphan_names = crate::db::attachments::get_orphan_files(&state.db)
            .await
            .unwrap_or_default();

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str())
                && !orphan_names.contains(&name.to_string())
            {
                let _ = tokio::fs::remove_file(&path).await;
                tracing::info!("Cleaned up orphan trash file: {}", path.display());
            }
        }
    }
}
