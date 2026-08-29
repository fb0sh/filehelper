use crate::state::AppState;
use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

// Called once at startup. Cheap: directory listings only, never hashes
// file contents.
pub async fn startup_cleanup(state: &AppState) {
    cleanup_tmp_parts(state).await;
    cleanup_file_orphans(state).await;
    cleanup_trash(state).await;
}

// Remove stale .part files from interrupted uploads (> 24h old).
async fn cleanup_tmp_parts(state: &AppState) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let cutoff = now - 86400;

    let Ok(mut entries) = tokio::fs::read_dir(&state.config.tmp_dir).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Ok(metadata) = entry.metadata().await else {
            continue;
        };
        let modified_secs = metadata
            .modified()
            .ok()
            .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs());
        let Some(modified_secs) = modified_secs else {
            continue;
        };
        let is_part = entry
            .path()
            .extension()
            .map(|e| e == "part")
            .unwrap_or(false);
        if is_part && modified_secs < cutoff {
            let path = entry.path();
            if let Err(e) = tokio::fs::remove_file(&path).await {
                tracing::warn!("Failed to remove stale tmp file {}: {e}", path.display());
            } else {
                tracing::info!("Cleaned up stale tmp file: {}", path.display());
            }
        }
    }
}

// Move files in files/ that have no DB row into trash. Covers uploads
// whose DB insert failed after the tmp→files rename.
async fn cleanup_file_orphans(state: &AppState) {
    let referenced: HashSet<String> =
        match crate::db::attachments::list_storage_names(&state.db).await {
            Ok(names) => names.into_iter().collect(),
            Err(e) => {
                tracing::warn!("Skipping files orphan cleanup, DB error: {e}");
                return;
            }
        };

    let Ok(mut entries) = tokio::fs::read_dir(&state.config.files_dir).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Some(name) = entry.file_name().to_str().map(|s| s.to_string()) else {
            continue;
        };
        if referenced.contains(&name) {
            continue;
        }
        match crate::files::storage::move_to_trash(
            &state.config.files_dir,
            &state.config.trash_dir,
            &name,
        )
        .await
        {
            Ok(_) => tracing::info!("Moved orphan file to trash: {name}"),
            Err(e) => tracing::warn!("Failed to move orphan file {name} to trash: {e}"),
        }
    }
}

// Delete trash files that no longer have a DB reference.
async fn cleanup_trash(state: &AppState) {
    let referenced: HashSet<String> =
        match crate::db::attachments::list_storage_names(&state.db).await {
            Ok(names) => names.into_iter().collect(),
            Err(e) => {
                tracing::warn!("Skipping trash cleanup, DB error: {e}");
                return;
            }
        };

    let Ok(mut entries) = tokio::fs::read_dir(&state.config.trash_dir).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Some(name) = entry.file_name().to_str().map(|s| s.to_string()) else {
            continue;
        };
        if referenced.contains(&name) {
            continue;
        }
        if let Err(e) = tokio::fs::remove_file(entry.path()).await {
            tracing::warn!("Failed to remove trash file {name}: {e}");
        } else {
            tracing::info!("Cleaned up trash file: {name}");
        }
    }
}
